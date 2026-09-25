// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import "./styles/global.css";
import { PlayerProvider, usePlayerState, usePlayerActions } from "./store/PlayerContext";
import { consumeTopBackHandler } from "./utils/backHandlerStack";
import { BACKGROUND_PLAYBACK_GUIDANCE } from "./utils/backgroundPlaybackWatchdog";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MiniPlayer from "./components/MiniPlayer";
import UndoSnackbar from "./components/UndoSnackbar";
import ResumePromptModal from "./components/ResumePromptModal";
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
const SPLASH_CEILING_MS = 8000;

function Shell() {
  const { theme, accentColor, artDim, fontFamily, queue, queueIndex, albums, backgroundKillNotice, newMusicFound, loadingLibrary, libraryHydrating, resumePrompt } =
    usePlayerState();
  const { dismissBackgroundKillNotice, initializeLibrary, dismissNewMusicFound, pickNativeFolder } = usePlayerActions();
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

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Both conditions matter: hydration decides whether the library is
    // on screen, and needsOnboarding decides whether the library is even
    // the right screen — lifting the splash while that's still null
    // would show the blank placeholder root.
    if (libraryHydrating || needsOnboarding === null) return;
    // Two frames, so the render that carries the hydrated library (and
    // the one Play Now's own stats effect schedules right after it) has
    // actually painted underneath before the logo lifts. Hiding on the
    // effect alone can reveal a frame of the pre-stats screen.
    const raf = requestAnimationFrame(() => requestAnimationFrame(hideSplash));
    return () => cancelAnimationFrame(raf);
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
  const rootStyle = { "--accent": accentColor, "--art-dim": artDim, fontFamily: getFontStack(fontFamily) };

  // needsOnboarding === null: still checking — render nothing rather than
  // flash the (empty) library before potentially replacing it with
  // onboarding a moment later.
  if (needsOnboarding === null) {
    return <div className={rootClass} data-theme={theme} style={rootStyle} />;
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
          {screen !== "nowplaying" && <MiniPlayer onOpen={() => setScreen("nowplaying")} />}
          {/* Both sit at Shell level on purpose: the undo has to outlive
              the screen that did the deleting, and the resume prompt can
              land on whatever screen the app happened to be left on. */}
          <UndoSnackbar />
          {resumePrompt && <ResumePromptModal prompt={resumePrompt} />}
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
