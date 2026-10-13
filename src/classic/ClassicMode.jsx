// src/classic/ClassicMode.jsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { usePlayerState, usePlayerActions, usePlayerTime } from "../store/PlayerContext";
import { albumIdForTrack } from "../audio/metadata";
import { pushBackHandler } from "../utils/backHandlerStack";
import NoteMark from "../components/NoteMark";
import ClickWheel from "./ClickWheel";
import "./classic.css";

// The device body in layout units. Every other dimension in classic.css
// is a multiple of --u, so these two numbers plus the scale factor below
// are the entire layout: a 200x336 shell (the proportions of a pocket
// player), a 4:3 screen inset at the top, and a 150-unit wheel under it.
const BODY_W = 200;
const BODY_H = 336;
// Breathing room around the body, in real px rather than units — this is
// a margin against the physical screen edge and the status bar, so it
// shouldn't shrink along with the body on a small display.
const VIEWPORT_PAD = 12;
// A hard ceiling only matters on a tablet or a desktop window, where an
// unclamped scale would blow the body up to something absurd and the
// 9-unit screen text would turn into headlines.
const MAX_SCALE = 3.4;

// Rows that fit the 4:3 screen below the title bar: 129 units tall, 16 of
// which is the title bar, at 14 units per row. Hardcoded rather than
// measured because the ratio is fixed by those constants in classic.css —
// if one changes, both change together.
const VISIBLE_ROWS = 8;

// Seconds per wheel step when the wheel is scrubbing on Now Playing. A
// quarter turn (six steps) is 30 seconds, which is about the granularity
// a thumb can aim for on a screen this size.
const SCRUB_STEP_S = 5;

export const CLASSIC_COLORWAYS = [
  { id: "white", label: "Classic White" },
  { id: "black", label: "Classic Black" },
  { id: "marine", label: "Marine Blue" },
];

const REPEAT_LABELS = { off: "Off", all: "All", one: "One" };

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Keeps the selected row on screen with the least scrolling that does so,
// biased to sit a third of the way down rather than dead centre: moving
// down a long list then shows more of what's coming than what's past.
function windowStart(sel, count) {
  const maxStart = Math.max(0, count - VISIBLE_ROWS);
  return Math.min(Math.max(0, sel - Math.floor((VISIBLE_ROWS - 1) / 3)), maxStart);
}

export default function ClassicMode() {
  const {
    albums, library, generalLibrary, playlists, coverOverrides,
    queue, queueIndex, playing, shuffle, repeatMode, classicColorway,
  } = usePlayerState();
  const { currentTime, duration } = usePlayerTime();
  const actions = usePlayerActions();

  // --- a single scale factor for the whole body ---------------------
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    function measure() {
      // visualViewport is the honest number on Android when the
      // soft keyboard or a system bar is overlaying the window;
      // innerWidth/Height keep reporting the full window.
      const vw = window.visualViewport?.width || window.innerWidth;
      const vh = window.visualViewport?.height || window.innerHeight;
      const fit = Math.min((vw - VIEWPORT_PAD * 2) / BODY_W, (vh - VIEWPORT_PAD * 2) / BODY_H);
      setScale(Math.max(0.5, Math.min(fit, MAX_SCALE)));
    }
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // --- navigation stack ---------------------------------------------
  // Each entry carries its own selected row, so MENU returns you to the
  // row you came in on rather than the top of the list.
  const [stack, setStack] = useState([{ kind: "root", sel: 0 }]);
  const top = stack[stack.length - 1];

  const push = useCallback((entry) => setStack((s) => [...s, { sel: 0, ...entry }]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const setSel = useCallback((sel) => {
    setStack((s) => {
      const next = [...s];
      next[next.length - 1] = { ...next[next.length - 1], sel };
      return next;
    });
  }, []);
  // Pushing Now Playing from a track that was just selected shouldn't
  // stack a second copy if it's already the screen you're on.
  const showNowPlaying = useCallback(() => {
    setStack((s) => (s[s.length - 1].kind === "np" ? s : [...s, { kind: "np", sel: 0 }]));
  }, []);

  // Hardware/gesture back behaves exactly like MENU, and only exits the
  // app from the root menu — the same rule the normal UI's back handler
  // follows for the library root. Registered through the shared stack so
  // App.jsx's single native listener drives it.
  const navRef = useRef();
  navRef.current = { depth: stack.length, pop };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    return pushBackHandler(() => {
      if (navRef.current.depth > 1) navRef.current.pop();
      else CapacitorApp.exitApp();
    });
  }, []);

  // --- derived library views ----------------------------------------
  const songs = useMemo(
    () => [...generalLibrary].sort((a, b) => (a.title || "").localeCompare(b.title || "")),
    [generalLibrary]
  );
  const sortedAlbums = useMemo(
    () => [...albums].sort((a, b) => (a.title || "").localeCompare(b.title || "")),
    [albums]
  );
  // Artists are grouped on album-artist where a file has one, falling
  // back to the track artist — the same precedence groupIntoAlbums uses,
  // so a compilation doesn't split one album across several artists here
  // while staying whole in the Albums list.
  const artists = useMemo(() => {
    const byKey = new Map();
    for (const t of generalLibrary) {
      const name = t.albumArtist || t.artist || "Unknown Artist";
      const key = name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, name, tracks: [] });
      byKey.get(key).tracks.push(t);
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [generalLibrary]);

  const tracksOfPlaylist = useCallback(
    (playlist) => playlist.trackIds.map((id) => library.find((t) => t.id === id)).filter(Boolean),
    [library]
  );

  const currentTrack = queue[queueIndex] || null;

  // --- screen definitions -------------------------------------------
  // One function builds every list screen: a title plus rows, where each
  // row owns what selecting it does. Playback always goes through the
  // store's existing actions — this skin adds no queue logic of its own.
  const screen = useMemo(() => {
    const playFrom = (tracks, track) => {
      actions.playTrackListFrom(tracks, track);
      showNowPlaying();
    };

    switch (top.kind) {
      case "root":
        return {
          title: "uPod",
          rows: [
            { label: "Music", arrow: true, onSelect: () => push({ kind: "music" }) },
            { label: "Playlists", arrow: true, onSelect: () => push({ kind: "playlists" }) },
            {
              label: "Shuffle Songs",
              onSelect: () => {
                if (songs.length === 0) return;
                actions.playTrackList(songs, { shuffle: true });
                showNowPlaying();
              },
            },
            { label: "Settings", arrow: true, onSelect: () => push({ kind: "settings" }) },
            { label: "Now Playing", arrow: true, onSelect: showNowPlaying },
          ],
        };

      case "music":
        return {
          title: "Music",
          rows: [
            { label: "Artists", value: String(artists.length), arrow: true, onSelect: () => push({ kind: "artists" }) },
            { label: "Albums", value: String(sortedAlbums.length), arrow: true, onSelect: () => push({ kind: "albums" }) },
            { label: "Songs", value: String(songs.length), arrow: true, onSelect: () => push({ kind: "songs" }) },
          ],
        };

      case "artists":
        return {
          title: "Artists",
          empty: "No music yet",
          rows: artists.map((a) => ({
            label: a.name,
            arrow: true,
            onSelect: () => push({ kind: "artist", artistKey: a.key }),
          })),
        };

      case "artist": {
        const artist = artists.find((a) => a.key === top.artistKey);
        if (!artist) return { title: "Artist", empty: "Not in the library any more", rows: [] };
        const artistAlbums = sortedAlbums.filter((al) =>
          al.tracks.some((t) => (t.albumArtist || t.artist || "Unknown Artist").toLowerCase() === artist.key)
        );
        return {
          title: artist.name,
          rows: [
            { label: "All Songs", value: String(artist.tracks.length), onSelect: () => playFrom(artist.tracks, artist.tracks[0]) },
            ...artistAlbums.map((al) => ({
              label: al.title,
              value: al.year ? String(al.year) : undefined,
              arrow: true,
              onSelect: () => push({ kind: "album", albumId: al.id }),
            })),
          ],
        };
      }

      case "albums":
        return {
          title: "Albums",
          empty: "No music yet",
          rows: sortedAlbums.map((al) => ({
            label: al.title,
            value: al.artist,
            arrow: true,
            onSelect: () => push({ kind: "album", albumId: al.id }),
          })),
        };

      case "album": {
        const album = sortedAlbums.find((a) => a.id === top.albumId);
        if (!album) return { title: "Album", empty: "Not in the library any more", rows: [] };
        return {
          title: album.title,
          rows: album.tracks.map((t) => ({
            label: t.title,
            nowPlaying: currentTrack?.id === t.id,
            onSelect: () => {
              actions.playAlbumFromTrack(album, t);
              showNowPlaying();
            },
          })),
        };
      }

      case "songs":
        return {
          title: "Songs",
          empty: "No music yet",
          rows: songs.map((t) => ({
            label: t.title,
            value: t.artist,
            nowPlaying: currentTrack?.id === t.id,
            onSelect: () => playFrom(songs, t),
          })),
        };

      case "playlists":
        return {
          title: "Playlists",
          empty: "No playlists yet",
          rows: playlists.map((p) => ({
            label: p.name,
            value: String(p.trackIds.length),
            arrow: true,
            onSelect: () => push({ kind: "playlist", playlistId: p.id }),
          })),
        };

      case "playlist": {
        const playlist = playlists.find((p) => p.id === top.playlistId);
        if (!playlist) return { title: "Playlist", empty: "That playlist is gone", rows: [] };
        const tracks = tracksOfPlaylist(playlist);
        return {
          title: playlist.name,
          empty: "Nothing in here yet",
          rows: tracks.map((t) => ({
            label: t.title,
            value: t.artist,
            nowPlaying: currentTrack?.id === t.id,
            onSelect: () => {
              actions.playPlaylist(playlist, t);
              showNowPlaying();
            },
          })),
        };
      }

      case "queue":
        return {
          title: "Up Next",
          empty: "The queue is empty",
          rows: queue.map((t, i) => ({
            label: t.title,
            value: t.artist,
            nowPlaying: i === queueIndex,
            onSelect: () => {
              actions.jumpToQueueIndex(i);
              pop();
            },
          })),
        };

      case "settings":
        return {
          title: "Settings",
          rows: [
            {
              label: "Colorway",
              value: CLASSIC_COLORWAYS.find((c) => c.id === classicColorway)?.label,
              arrow: true,
              onSelect: () => push({ kind: "colorway" }),
            },
            { label: "Shuffle", value: shuffle ? "On" : "Off", onSelect: actions.toggleShuffle },
            { label: "Repeat", value: REPEAT_LABELS[repeatMode] || "Off", onSelect: actions.cycleRepeat },
            { label: "Leave Classic mode", onSelect: () => actions.setClassicMode(false) },
          ],
        };

      case "colorway":
        return {
          title: "Colorway",
          rows: CLASSIC_COLORWAYS.map((c) => ({
            label: c.label,
            value: c.id === classicColorway ? "✓" : undefined,
            onSelect: () => actions.setClassicColorway(c.id),
          })),
        };

      default:
        return { title: "uPod", rows: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    top, artists, sortedAlbums, songs, playlists, queue, queueIndex, currentTrack,
    shuffle, repeatMode, classicColorway, actions, push, pop, showNowPlaying, tracksOfPlaylist,
  ]);

  // --- wheel wiring --------------------------------------------------
  // Scrub target is held in a ref and committed on a frame rather than
  // seeking per step: a flick emits steps faster than the audio element
  // can honour a currentTime write, and seeking on every one of them
  // stutters and ends up somewhere short of where the wheel asked for.
  const scrubRef = useRef(null);
  const [scrubPreview, setScrubPreview] = useState(null);
  const scrubFrameRef = useRef(0);

  const handleStep = useCallback(
    (dir) => {
      if (top.kind === "np") {
        if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return;
        const from = scrubRef.current ?? currentTime;
        const target = Math.min(Math.max(0, from + dir * SCRUB_STEP_S), duration);
        scrubRef.current = target;
        setScrubPreview(target);
        if (!scrubFrameRef.current) {
          scrubFrameRef.current = requestAnimationFrame(() => {
            scrubFrameRef.current = 0;
            if (scrubRef.current != null) actions.seek(scrubRef.current);
          });
        }
        return;
      }
      const count = screen.rows.length;
      if (count === 0) return;
      setSel(Math.min(Math.max(0, top.sel + dir), count - 1));
    },
    [top, screen.rows.length, currentTrack, duration, currentTime, actions, setSel]
  );

  // The preview is only there to stop the bar snapping back to the
  // element's lagging currentTime mid-flick; once a real tick arrives at
  // the scrubbed position it has nothing left to do.
  useEffect(() => {
    if (scrubPreview == null) return;
    const t = setTimeout(() => {
      scrubRef.current = null;
      setScrubPreview(null);
    }, 450);
    return () => clearTimeout(t);
  }, [scrubPreview]);

  useEffect(() => () => cancelAnimationFrame(scrubFrameRef.current), []);

  const handleSelect = useCallback(() => {
    if (top.kind === "np") {
      push({ kind: "queue" });
      return;
    }
    screen.rows[top.sel]?.onSelect?.();
  }, [top, screen.rows, push]);

  const rootStyle = { "--u": `${scale}px` };

  return (
    <div className="classic-root" data-colorway={classicColorway} style={rootStyle}>
      <button className="cl-exit" onClick={() => actions.setClassicMode(false)}>
        Exit Classic
      </button>
      <div className="cl-body">
        <div className="cl-bezel">
          <div className="cl-screen">
            {top.kind === "np" ? (
              <NowPlayingScreen
                track={currentTrack}
                queue={queue}
                queueIndex={queueIndex}
                playing={playing}
                shuffle={shuffle}
                repeatMode={repeatMode}
                currentTime={scrubPreview ?? currentTime}
                duration={duration}
                scrubbing={scrubPreview != null}
                coverOverrides={coverOverrides}
              />
            ) : (
              <ListScreen title={screen.title} rows={screen.rows} sel={top.sel} empty={screen.empty} playing={playing} />
            )}
          </div>
        </div>
        <ClickWheel
          onStep={handleStep}
          onSelect={handleSelect}
          onMenu={pop}
          onPrev={actions.previous}
          onNext={actions.next}
          onPlayPause={actions.togglePlay}
        />
      </div>
    </div>
  );
}

function TitleBar({ title, playing }) {
  return (
    <div className="cl-titlebar">
      <div className="cl-title-side">
        {playing ? <PlayPip /> : null}
      </div>
      <div className="cl-title-text">{title}</div>
      <div className="cl-title-side right" />
    </div>
  );
}

// The "something is playing" pip in the title bar — a drawn triangle, not
// a glyph, so it stays crisp at any --u.
function PlayPip() {
  return (
    <svg className="cl-pip" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M2 1 L9 5 L2 9 Z" />
    </svg>
  );
}

function ListScreen({ title, rows, sel, empty, playing }) {
  const start = windowStart(sel, rows.length);
  const visible = rows.slice(start, start + VISIBLE_ROWS);
  return (
    <>
      <TitleBar title={title} playing={playing} />
      {rows.length === 0 ? (
        <div className="cl-empty">{empty || "Nothing here"}</div>
      ) : (
        <div className="cl-list">
          {visible.map((row, i) => {
            const index = start + i;
            return (
              <div key={row.key || `${index}-${row.label}`} className={`cl-row ${index === sel ? "sel" : ""}`}>
                {row.nowPlaying && <span className="cl-row-playing" />}
                <span className="cl-row-label">{row.label}</span>
                {row.value && <span className="cl-row-value">{row.value}</span>}
                {row.arrow && <span className="cl-row-arrow" />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function NowPlayingScreen({ track, queue, queueIndex, playing, shuffle, repeatMode, currentTime, duration, scrubbing, coverOverrides }) {
  if (!track) {
    return (
      <>
        <TitleBar title="Now Playing" playing={false} />
        <div className="cl-empty">Nothing playing yet — pick a song from Music.</div>
      </>
    );
  }
  // Same precedence the normal UI uses: a user-chosen cover for the
  // track's album wins over whatever was embedded in the file.
  const cover = coverOverrides[albumIdForTrack(track)] || track.cover;
  const total = Number.isFinite(duration) && duration > 0 ? duration : track.duration || 0;
  const pct = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;
  const flags = [shuffle && "SHUFFLE", repeatMode === "all" && "REPEAT ALL", repeatMode === "one" && "REPEAT ONE"].filter(Boolean);

  return (
    <>
      <TitleBar title={`${queueIndex + 1} of ${queue.length}`} playing={playing} />
      <div className="cl-np">
        <div className="cl-np-top">
          <div
            className={`cl-np-art ${cover ? "" : "cl-np-art-fallback"}`}
            style={cover ? { backgroundImage: `url(${cover})` } : undefined}
          >
            {!cover && <NoteMark className="cl-note" size={26} />}
          </div>
          <div className="cl-np-meta">
            <div className="cl-np-title">{track.title}</div>
            <div className="cl-np-artist">{track.artist || "Unknown Artist"}</div>
            <div className="cl-np-album">{track.album || ""}</div>
            {flags.length > 0 && (
              <div className="cl-np-flags">{flags.map((f) => <span key={f}>{f}</span>)}</div>
            )}
          </div>
        </div>
        <div className="cl-np-bar-wrap">
          <div className="cl-np-bar">
            <div className="cl-np-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="cl-np-times">
            <span>{fmtTime(currentTime)}</span>
            <span>{scrubbing ? "scrubbing" : "Select: Up Next"}</span>
            <span>-{fmtTime(Math.max(0, total - currentTime))}</span>
          </div>
        </div>
      </div>
    </>
  );
}
