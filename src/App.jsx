// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import "./styles/global.css";
import { PlayerProvider, usePlayerState, usePlayerActions } from "./store/PlayerContext";
import { consumeTopBackHandler } from "./utils/backHandlerStack";
import { onSharedUrl } from "./utils/shareTarget";
import {
  downloadAudio,
  newDownloadId,
  prepareEngine,
  searchYouTube,
  notifyDownloadsFinished,
  clearDownloadNotifications,
  onDownloadReviewRequest,
} from "./download/audioDownload";
import { addArrivals, loadPendingArrivals } from "./download/arrivals";
import { isSpotifyUrl, resolveSpotifyTrack, pickBestMatch } from "./download/spotify";
import { describeSource } from "./download/qualityPresets";
import { BACKGROUND_PLAYBACK_GUIDANCE } from "./utils/backgroundPlaybackWatchdog";
import ErrorBoundary from "./components/ErrorBoundary";
import ClassicMode from "./classic/ClassicMode";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MiniPlayer from "./components/MiniPlayer";
import UndoSnackbar from "./components/UndoSnackbar";
import ResumePromptModal from "./components/ResumePromptModal";
import DownloadAudioModal from "./components/DownloadAudioModal";
import DownloadDock from "./components/DownloadDock";
import DownloadArrivalToast from "./components/DownloadArrivalToast";
import DownloadReviewModal from "./components/DownloadReviewModal";
import NowPlaying from "./screens/NowPlaying";
import Library from "./screens/Library";
import AlbumDetail from "./screens/AlbumDetail";
import EqScreen from "./screens/EqScreen";
import Studio from "./screens/Studio";
import PlaylistDetail from "./screens/PlaylistDetail";
import InstantMix from "./screens/InstantMix";
import Karaoke from "./screens/Karaoke";
import Settings from "./screens/Settings";
import ReviewTracks from "./screens/ReviewTracks";
import WelcomeOnboarding from "./screens/WelcomeOnboarding";
import { AllFilesAccess } from "./utils/allFilesAccess";
import { getFontStack } from "./utils/fonts";
import { accentTextColor, accentFillColor } from "./utils/accentColor";

// Where the hardware/gesture back button should land from each top-level
// screen — mirrors the same targets each screen's own on-screen back
// button already uses (AlbumDetail/InstantMix -> library, eq/karaoke ->
// nowplaying since they're only ever opened from there). "playlist" isn't
// listed here because its target is dynamic (playlistOrigin). "library"
// has no entry: it's the root, so hardware back there falls through to
// exiting the app.
const SCREEN_BACK_TARGETS = {
  album: "library",
  instantmix: "library",
  eq: "nowplaying",
  karaoke: "nowplaying",
  nowplaying: "library",
  studio: "library",
  settings: "library",
  reviewtracks: "settings",
};

// Ceiling on how long the splash may stay up waiting for hydration. It is
// deliberately far above any normal launch (hydration is ~1.5s on this
// library) — it exists only so a pathological cold IndexedDB read or a
// much larger library can't strand the user on a logo with no way
// forward. When it fires the app falls back to the old behaviour: the
// library screen with its loading skeleton, which is honest about still
// working rather than pretending to be empty.
const SPLASH_CEILING_MS = 12000;

// The logo is held for at least this long. Not a stall for its own sake:
// hydration can finish in a couple of hundred milliseconds on a warm
// start, and lifting the splash that fast produces a flash of logo rather
// than a launch — and it lands the user on a screen whose covers are
// still decoding, which is the "it needs a second or two after the logo"
// feeling. Below this the launch doesn't read as faster, it reads as
// janky.
const SPLASH_MIN_MS = 900;

// Extra grace, after hydration, for the current track's cover to decode
// before the splash lifts. Capped because a cover that won't decode must
// not be able to hold the app behind a logo.
const COVER_WARMUP_MS = 600;

// How many album covers from the top of the library grid to decode before
// lifting the splash — roughly the first screenful, since anything below
// the fold has until the user scrolls to it.
const SPLASH_WARM_COVERS = 12;

// Resolves once the image at `url` is decoded and ready to paint, or
// after `timeout` either way. Launch readiness is allowed to wait on this
// but never to depend on it.
function warmImage(url, timeout) {
  if (!url) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
      img.decode?.().then(resolve, resolve);
    }),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);
}

function Shell() {
  const { theme, accentColor, artDim, fontFamily, queue, queueIndex, albums, library, backgroundKillNotice, newMusicFound, loadingLibrary, libraryHydrating, resumePrompt, classicMode, miniPlayerHidden, pendingArrivals } =
    usePlayerState();
  const {
    dismissBackgroundKillNotice,
    initializeLibrary,
    dismissNewMusicFound,
    pickNativeFolder,
    checkForNewMusic,
    ingestDownloadedFiles,
    setPendingArrivals,
    clearArrivals,
  } = usePlayerActions();
  // null while checking (avoids a flash of the wrong screen), then true
  // only on a fresh install/reinstall where "All files access" hasn't
  // been granted yet — see WelcomeOnboarding.jsx for why this can't just
  // be a "have I shown this before" flag.
  const [needsOnboarding, setNeedsOnboarding] = useState(null);
  const [screen, setScreen] = useState("library");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [activePlaylist, setActivePlaylist] = useState(null);
  // Remembers which screen opened the playlist (library, studio, sidebar
  // shortcut...) so the playlist's Back button returns you there instead
  // of always dropping you back on Studio.
  const [playlistOrigin, setPlaylistOrigin] = useState("library");
  // The URL of a link shared in from YouTube/Instagram, held only for as
  // long as the quality picker is up. Nothing is fetched until a quality
  // is chosen — a share is a request to be asked, not to start a download.
  const [sharedUrl, setSharedUrl] = useState(null);
  // In-flight and recently-finished downloads, newest first. Finished
  // and failed rows stay until dismissed; a success is also cleared
  // automatically once the library has been told to look again.
  const [downloads, setDownloads] = useState([]);
  // Metadata for a shared Spotify link, resolved while the sheet is up
  // so the user can see which track uPod is about to go looking for.
  const [spotify, setSpotify] = useState({ resolving: false, track: null, error: null });

  // Hardware/gesture back button: without this, @capacitor/app's default
  // behavior (no web history to fall back on, since this is a plain state
  // machine rather than a router) is to exit the app immediately from
  // anywhere. Priority order: close a modal/sheet first (any registered
  // via useBackButtonClose, e.g. Queue, AddToPlaylist, MetadataEdit,
  // TrackActionsMenu, FontPicker), then close the sidebar, then navigate
  // up a level using the same targets each screen's own back button uses,
  // and only exit once already at the library root with nothing open.
  const backStateRef = useRef();
  backStateRef.current = { screen, sidebarOpen, playlistOrigin };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle;
    CapacitorApp.addListener("backButton", () => {
      if (consumeTopBackHandler()) return;
      const { screen: curScreen, sidebarOpen: curSidebarOpen, playlistOrigin: curOrigin } = backStateRef.current;
      if (curSidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (curScreen === "playlist") {
        setScreen(curOrigin);
        return;
      }
      const target = SCREEN_BACK_TARGETS[curScreen];
      if (target) {
        setScreen(target);
        return;
      }
      CapacitorApp.exitApp();
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle?.remove();
    };
  }, []);

  // Share > uPod from any app. Covers both the cold start (uPod launched
  // by the share) and a share arriving while uPod is already open — see
  // utils/shareTarget.js for how those two paths are unified.
  useEffect(() => onSharedUrl(setSharedUrl), []);

  // Unpack the bundled yt-dlp/ffmpeg while the picker is up, so the
  // first-ever download doesn't appear to hang through it.
  useEffect(() => {
    if (sharedUrl) prepareEngine();
  }, [sharedUrl]);

  // A Spotify link carries no audio uPod can take (see spotify.js), so
  // the sheet resolves the track's details up front and the download
  // becomes a search for the same recording on YouTube.
  useEffect(() => {
    if (!sharedUrl || !isSpotifyUrl(sharedUrl)) {
      setSpotify({ resolving: false, track: null, error: null });
      return;
    }
    let live = true;
    setSpotify({ resolving: true, track: null, error: null });
    resolveSpotifyTrack(sharedUrl)
      .then((track) => live && setSpotify({ resolving: false, track, error: null }))
      .catch((err) =>
        live && setSpotify({ resolving: false, track: null, error: err?.message || "Couldn't read that Spotify link." }),
      );
    return () => {
      live = false;
    };
  }, [sharedUrl]);

  const patchDownload = (id, patch) =>
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // Files finished since the last batch was wrapped up, and the job ids
  // that produced them. A ref rather than state because finalizeBatch
  // reads it from inside an event handler that was created on an older
  // render — and because changing it must never cause a re-render on its
  // own, these are only ever read at the moment a batch settles.
  const batchRef = useRef({ paths: [], jobIds: [], finalizing: false });
  // The review sheet, opened either from the arrival card or from a tap
  // on the notification.
  const [reviewOpen, setReviewOpen] = useState(false);

  // One job can be one file or a whole album: a shared playlist URL is a
  // single yt-dlp invocation that writes a track per entry, which is
  // exactly the case the review exists for. See pathsIn() in
  // AudioDownloadPlugin.java.
  function pathsFromDoneEvent(ev) {
    if (Array.isArray(ev?.paths) && ev.paths.length) return ev.paths;
    return ev?.path ? [ev.path] : [];
  }

  // Called when nothing is downloading any more. Reads the just-saved
  // files into the library (no full rescan — see ingestDownloadedFiles),
  // then announces them exactly once: an in-app card if uPod is in
  // front of the user, a notification in the shade if it isn't.
  async function finalizeBatch() {
    const batch = batchRef.current;
    if (batch.finalizing || batch.paths.length === 0) return;
    batch.finalizing = true;
    const paths = batch.paths;
    const jobIds = batch.jobIds;
    batchRef.current = { paths: [], jobIds: [], finalizing: false };

    // Persisted before anything else can fail: from here on the batch is
    // something the user is owed an answer about, and that has to
    // survive the process being killed between the download and the tap
    // on the notification.
    await addArrivals({ paths, sourceUrl: sharedUrlRef.current });

    let tracks = [];
    try {
      tracks = await ingestDownloadedFiles(paths);
    } catch (err) {
      console.warn("Couldn't read the downloaded files into the library:", err);
    }

    if (tracks.length === 0) {
      // Nothing could be read — a file saved outside the music folder,
      // or permission lost mid-flight. Fall back to the folder re-walk
      // that notices files added over USB, so the tracks at least
      // surface through the "found new files" banner.
      checkForNewMusic();
      return;
    }

    setPendingArrivals({ trackIds: tracks.map((t) => t.id), at: Date.now() });

    // A settled batch has been accounted for; leaving its "Saved" rows
    // in the dock under a card that says the same thing is clutter.
    setDownloads((prev) => prev.filter((d) => d.status !== "done"));

    const active = await appIsActive();
    if (active) {
      // The card below is about to say all of this; the shade shouldn't
      // also be carrying "Saving audio" rows for work that is over.
      clearDownloadNotifications(jobIds);
    } else {
      notifyDownloadsFinished({
        title: tracks.length === 1 ? "1 track downloaded" : `${tracks.length} tracks downloaded`,
        text: "Tap to name them and bundle them into an album",
        lines: tracks.map((t) => `${t.title} — ${t.artist}`),
        jobIds,
      });
    }
  }

  // Whether uPod is the app on screen right now. getState() is the only
  // honest answer: the web layer keeps running while backgrounded, so a
  // download finishing in a pocket reaches this code exactly the same
  // way one finishing in the foreground does.
  async function appIsActive() {
    if (!Capacitor.isNativePlatform()) return true;
    try {
      const { isActive } = await CapacitorApp.getState();
      return isActive;
    } catch {
      return true;
    }
  }

  // The last link shared in, kept past the point where sharedUrl is
  // cleared (the sheet closes as soon as a quality is picked) so a
  // finished batch can still record where it came from.
  const sharedUrlRef = useRef(null);

  // Job ids that haven't settled yet. A batch is "everything that was in
  // flight at once", so three links shared back-to-back produce one
  // review rather than three sheets — and the count has to be tracked
  // here rather than read off `downloads`, because setDownloads is
  // asynchronous and the row that just finished would still read as
  // running from inside its own event handler.
  const liveJobsRef = useRef(new Set());

  function settleJob(id) {
    liveJobsRef.current.delete(id);
    if (liveJobsRef.current.size === 0) finalizeBatch();
  }

  const downloadHandlers = {
    onProgress: (ev) => patchDownload(ev.id, { percent: ev.percent, etaSeconds: ev.etaSeconds }),
    onDone: (ev) => {
      patchDownload(ev.id, { status: "done", percent: 100 });
      batchRef.current.paths.push(...pathsFromDoneEvent(ev));
      if (!batchRef.current.jobIds.includes(ev.id)) batchRef.current.jobIds.push(ev.id);
      settleJob(ev.id);
    },
    onFailed: (ev) => {
      patchDownload(ev.id, { status: "failed", message: ev.message });
      settleJob(ev.id);
    },
  };

  async function startDownload(url, preset, track) {
    // A resolved Spotify track names itself; anything else is named by
    // source and quality until yt-dlp reports a real title. Either is
    // enough to tell two concurrent downloads apart, which a bare
    // "Downloading…" would not be.
    const label = track ? `${track.artist} · ${track.title}` : `${describeSource(url)} · ${preset.label}`;
    const id = newDownloadId();
    liveJobsRef.current.add(id);
    sharedUrlRef.current = url;
    // On screen before the job is queued — see newDownloadId().
    setDownloads((prev) => [
      { id, label, status: track ? "searching" : "running", percent: null, etaSeconds: null },
      ...prev,
    ]);

    try {
      let target = url;
      let outputName;

      if (track) {
        // Spotify's own audio is DRM'd, so the download is really a
        // hunt for the same recording on YouTube. The duration gate
        // lives in pickBestMatch — better to say nothing was found than
        // to quietly hand over a live version or an hour-long loop.
        const candidates = await searchYouTube(`${track.artist} ${track.title}`, 5);
        const best = pickBestMatch(candidates, track);
        if (!best) {
          patchDownload(id, {
            status: "failed",
            message: "No close enough match on YouTube — nothing within a few seconds of the Spotify version.",
          });
          settleJob(id);
          return;
        }
        target = `https://www.youtube.com/watch?v=${best.id}`;
        outputName = `${track.artist} - ${track.title}`;
        patchDownload(id, { status: "running" });
      }

      await downloadAudio(id, target, preset, downloadHandlers, { outputName });
    } catch (err) {
      patchDownload(id, { status: "failed", message: err?.message || "Couldn't start the download." });
      settleJob(id);
    }
  }

  const dismissDownload = (id) => setDownloads((prev) => prev.filter((d) => d.id !== id));

  // The tracks the review is about, resolved fresh from the library so
  // the sheet shows (and saves over) current values rather than a
  // snapshot taken when the download finished.
  const arrivalTracks = useMemo(() => {
    if (!pendingArrivals?.trackIds?.length) return [];
    const byId = new Map(library.map((t) => [t.id, t]));
    return pendingArrivals.trackIds.map((id) => byId.get(id)).filter(Boolean);
  }, [pendingArrivals, library]);

  // A tap on the "downloads finished" notification, whether it launched
  // uPod or just brought it forward. The arrivals it refers to are
  // picked up by the effect below — this only says which way the user
  // came in, and therefore that the sheet should open rather than the
  // card.
  useEffect(
    () =>
      onDownloadReviewRequest(() => {
        setReviewOpen(true);
        clearDownloadNotifications([]);
      }),
    []
  );

  // Arrivals that outlived the process that downloaded them: the batch
  // finished, the notification was posted, and uPod was killed (or
  // simply never opened) before anyone answered it. The paths are on
  // disk in Preferences; the tracks themselves are already in the
  // cached library by now, so this just has to find them again.
  //
  // Waits for hydration, because before that the library is empty and
  // every arrival would resolve to nothing.
  const arrivalsRestoredRef = useRef(false);
  useEffect(() => {
    if (libraryHydrating || arrivalsRestoredRef.current || pendingArrivals) return;
    arrivalsRestoredRef.current = true;
    (async () => {
      const pending = await loadPendingArrivals();
      if (!pending?.paths?.length) return;
      // Matched on path rather than on track id, because an id also
      // carries the file's size and mtime — recomputing those would
      // mean stat'ing every file again, when the absolute path that was
      // persisted already ends in exactly the folder-relative path the
      // library stores.
      const tracks = library.filter(
        (t) => t.relativePath && pending.paths.some((abs) => abs.endsWith(`/${t.relativePath}`))
      );
      if (tracks.length === 0) return;
      setPendingArrivals({ trackIds: tracks.map((t) => t.id), at: pending.at });
      // They've opened the app and the card is about to appear, so the
      // notification that was trying to get them here has done its job.
      clearDownloadNotifications([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryHydrating]);

  // One-time check on mount — PlayerContext's own launch effect already
  // bails out silently if storage permission isn't granted (see
  // initializeLibrary in PlayerContext.jsx), so this is what actually
  // decides whether the onboarding screen or the real app shows.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setNeedsOnboarding(false);
      return;
    }
    AllFilesAccess.check().then(({ granted, applicable }) => {
      setNeedsOnboarding(applicable && !granted);
    });
  }, []);

  // The native splash is configured with launchAutoHide: false (see
  // capacitor.config.json), so it stays up until this hides it — which is
  // the whole point: the empty window the user used to see was the app
  // rendering itself before the IndexedDB cache had been read. Now the
  // logo simply stays up a little longer and the library is already there
  // when it lifts.
  const splashHiddenRef = useRef(false);
  function hideSplash() {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    SplashScreen.hide({ fadeOutDuration: 200 }).catch((err) => {
      console.warn("Couldn't hide splash screen:", err);
    });
  }

  // When this component first mounted — the splash has been up since
  // before that, so this is a conservative floor for SPLASH_MIN_MS.
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Both conditions matter: hydration decides whether the library is
    // on screen, and needsOnboarding decides whether the library is even
    // the right screen — lifting the splash while that's still null
    // would show the blank placeholder root.
    if (libraryHydrating || needsOnboarding === null) return;

    let cancelled = false;
    let raf;
    (async () => {
      // The restored queue's cover is the one image guaranteed to be on
      // screen the instant the splash lifts (the mini player, and Now
      // Playing if that's where the user left off). Decoding it behind
      // the logo is the difference between arriving at a finished screen
      // and watching it fill in.
      await Promise.all([
        warmImage(queue[queueIndex]?.cover, COVER_WARMUP_MS),
        // Plus the album art the library grid opens on. All in parallel
        // and all behind the same cap, so this costs the launch one
        // COVER_WARMUP_MS at worst however many there are — and saves the
        // first screen from visibly filling in tile by tile.
        ...albums.slice(0, SPLASH_WARM_COVERS).map((a) => warmImage(a.cover, COVER_WARMUP_MS)),
      ]);
      const elapsed = Date.now() - mountedAtRef.current;
      if (elapsed < SPLASH_MIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS - elapsed));
      }
      if (cancelled) return;
      // Two frames, so the render that carries the hydrated library (and
      // the one Play Now's own stats effect schedules right after it) has
      // actually painted underneath before the logo lifts. Hiding on the
      // effect alone can reveal a frame of the pre-stats screen.
      raf = requestAnimationFrame(() => requestAnimationFrame(hideSplash));
    })();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryHydrating, needsOnboarding]);

  // Safety net only — see SPLASH_CEILING_MS.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const t = setTimeout(() => {
      if (!splashHiddenRef.current) {
        console.warn(`[upod] splash ceiling hit at ${SPLASH_CEILING_MS}ms — hydration still running`);
        hideSplash();
      }
    }, SPLASH_CEILING_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAccessGranted() {
    setNeedsOnboarding(false);
    initializeLibrary();
  }

  function openAlbum(album) {
    setActiveAlbum(album);
    setScreen("album");
  }

  function openPlaylist(playlist) {
    // If a playlist is opened from within another playlist (edge case),
    // keep the original origin rather than chaining to "playlist" itself.
    setPlaylistOrigin(screen === "playlist" ? playlistOrigin : screen);
    setActivePlaylist(playlist);
    setScreen("playlist");
  }

  const rootClass = Capacitor.isNativePlatform() ? "upod-root native-platform" : "upod-root";
  // --accent stays exactly what the cover gave us (fills, borders,
  // sliders). The other two are the same colour moved only in lightness
  // until it is actually readable — as text on this theme's background,
  // and as a background under white text. See accentColor.js.
  const rootStyle = {
    "--accent": accentColor,
    "--accent-text": accentTextColor(accentColor, theme),
    "--accent-fill": accentFillColor(accentColor),
    "--art-dim": artDim,
    fontFamily: getFontStack(fontFamily),
  };

  // needsOnboarding === null: still checking — render nothing rather than
  // flash the (empty) library before potentially replacing it with
  // onboarding a moment later.
  if (needsOnboarding === null) {
    return <div className={rootClass} data-theme={theme} style={rootStyle} />;
  }

  // The Classic skin replaces the entire normal shell, but nothing
  // underneath it: same PlayerProvider, same queue, same library, same
  // actions. It sits after the onboarding check so a fresh install still
  // gets the storage-permission screen first, and inside the same root
  // element so the chosen font still applies.
  if (classicMode) {
    return (
      <div className={rootClass} data-theme={theme} style={rootStyle}>
        <ClassicMode />
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className={rootClass} data-theme={theme} style={rootStyle}>
        <WelcomeOnboarding onGranted={handleAccessGranted} />
      </div>
    );
  }

  return (
    <div className={rootClass} data-theme={theme} style={rootStyle}>
      <div className="shell">
        <Sidebar
          screen={screen}
          setScreen={setScreen}
          open={sidebarOpen}
          setOpen={setSidebarOpen}
          onOpenPlaylist={openPlaylist}
        />
        <div className="main">
          <TopBar onMenu={() => setSidebarOpen(true)} screen={screen} />
          {backgroundKillNotice && (
            <div
              style={{
                margin: "0 14px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>Playback stopped in the background</div>
                <div className="settings-row-sub">
                  {BACKGROUND_PLAYBACK_GUIDANCE.primary} See Settings for the full guidance.
                </div>
              </div>
              <button className="ghost-btn" style={{ padding: "4px 10px" }} onClick={dismissBackgroundKillNotice}>
                Got it
              </button>
            </div>
          )}
          {newMusicFound && !loadingLibrary && (
            <div
              style={{
                margin: "0 14px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>
                  {newMusicFound.added > 0
                    ? `Found ${newMusicFound.added} new ${newMusicFound.added === 1 ? "file" : "files"}`
                    : newMusicFound.removed > 0
                      ? `${newMusicFound.removed} ${newMusicFound.removed === 1 ? "file is" : "files are"} no longer there`
                      : "Your music folder changed"}
                </div>
                <div className="settings-row-sub">
                  Rescan to pick up the changes — this reads tags for every track, so it takes a moment.
                </div>
              </div>
              <button className="ghost-btn" style={{ padding: "4px 10px" }} onClick={dismissNewMusicFound}>
                Not now
              </button>
              <button className="ghost-btn" style={{ padding: "4px 10px" }} onClick={pickNativeFolder}>
                Rescan
              </button>
            </div>
          )}
          <div className="content">
            {screen === "nowplaying" && (
              <NowPlaying
                onOpenAlbum={() => {
                  // Tapping the art/title should open the currently playing
                  // track's album — not whatever album was last explicitly
                  // browsed to. Playback can start from Songs, a playlist,
                  // Instant Mix, or the queue, none of which set activeAlbum,
                  // so that stale value can't be relied on here.
                  const track = queue[queueIndex];
                  const album = track && albums.find((a) => a.tracks.some((t) => t.id === track.id));
                  if (album) openAlbum(album);
                }}
                onOpenEq={() => setScreen("eq")}
                onOpenKaraoke={() => setScreen("karaoke")}
              />
            )}
            {screen === "library" && (
              <Library onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} onOpenInstantMix={() => setScreen("instantmix")} />
            )}
            {screen === "instantmix" && <InstantMix onBack={() => setScreen("library")} />}
            {screen === "album" && activeAlbum && (
              <AlbumDetail album={activeAlbum} onBack={() => setScreen("library")} />
            )}
            {screen === "eq" && <EqScreen />}
            {screen === "studio" && <Studio onOpenPlaylist={openPlaylist} />}
            {screen === "playlist" && activePlaylist && (
              <PlaylistDetail playlist={activePlaylist} onBack={() => setScreen(playlistOrigin)} />
            )}
            {screen === "karaoke" && <Karaoke />}
            {screen === "settings" && <Settings onOpenReviewTracks={() => setScreen("reviewtracks")} />}
            {screen === "reviewtracks" && <ReviewTracks onBack={() => setScreen("settings")} />}
          </div>
          {/* Above the mini player, below the scrolling content. It is a
              normal-flow sibling of .content rather than an overlay, so
              it has to sit ahead of MiniPlayer here — after it, the
              strip lands below the fold and is never seen. */}
          {/* Offset mirrors MiniPlayer's own render condition (see its
              early return) so the strip sits on the mini player when
              there is one and drops to the screen edge when there isn't. */}
          <DownloadDock
            downloads={downloads}
            onDismiss={dismissDownload}
            aboveMiniPlayer={screen !== "nowplaying" && !!queue[queueIndex] && !resumePrompt && !miniPlayerHidden}
          />
          {/* Sits where the dock's cards do and for the same reason: it
              is what those cards turn into once the disc stops
              spinning. Suppressed while the sheet it opens is already
              up. */}
          {arrivalTracks.length > 0 && !reviewOpen && (
            <div className={`arrival-toast-layer ${screen !== "nowplaying" && !!queue[queueIndex] && !resumePrompt && !miniPlayerHidden ? "above-mini-player" : ""}`}>
              <DownloadArrivalToast
                tracks={arrivalTracks}
                onReview={() => setReviewOpen(true)}
                onDismiss={() => {
                  clearArrivals();
                  clearDownloadNotifications([]);
                }}
              />
            </div>
          )}
          {screen !== "nowplaying" && <MiniPlayer onOpen={() => setScreen("nowplaying")} />}
          {/* Both sit at Shell level on purpose: the undo has to outlive
              the screen that did the deleting, and the resume prompt can
              land on whatever screen the app happened to be left on. */}
          <UndoSnackbar />
          {resumePrompt && <ResumePromptModal prompt={resumePrompt} />}
          {reviewOpen && arrivalTracks.length > 0 && (
            <DownloadReviewModal
              tracks={arrivalTracks}
              playlist={pendingArrivals?.playlist || null}
              // Either answer retires the batch: "leave as is" is a
              // decision about it, not a postponement, and the tracks
              // are already in the library either way.
              onDone={() => {
                setReviewOpen(false);
                clearArrivals();
                clearDownloadNotifications([]);
              }}
            />
          )}
          {sharedUrl && (
            <DownloadAudioModal
              url={sharedUrl}
              resolved={spotify.track}
              resolving={spotify.resolving}
              resolveError={spotify.error}
              onPick={(preset) => {
                startDownload(sharedUrl, preset, spotify.track);
                setSharedUrl(null);
              }}
              onClose={() => setSharedUrl(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </PlayerProvider>
  );
}
