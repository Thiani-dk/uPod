// src/store/PlayerContext.jsx
// Central player state + real HTML5 Audio playback engine.
import React, { createContext, useContext, useEffect, useReducer, useRef, useCallback, useMemo } from "react";
import { parseLibrary, groupIntoAlbums, normalizeKey } from "../audio/metadata";
import { Capacitor } from "@capacitor/core";
import {
  readNativeFolderAsFiles,
  ensureStoragePermission,
  getMusicFolderPath,
  hasConfirmedFolderOnce,
  markFolderConfirmedOnce,
} from "../audio/nativeFolder";
import { AudioEngine, EQ_PRESETS, EQ_FREQUENCIES } from "../audio/engine";
import { renderStudioEffect as renderEffectOffline } from "../audio/studioEffects";
import { audioBufferToWavBlob } from "../audio/wav";
import { audioBufferToMp3Blob } from "../audio/mp3";
import { fetchCanonicalTrackOrder, matchTracksToOrder } from "../online/trackOrder";
import { extractAccentColor, FALLBACK_ACCENT } from "../utils/accentColor";
import { recordListen } from "../utils/listeningStats";
import { loadFont } from "../utils/fonts";
import { MediaSession } from "@capgo/capacitor-media-session";

const PlayerStateContext = createContext(null);
const PlayerActionsContext = createContext(null);
// currentTime updates on every audio "timeupdate" tick (several times a
// second during playback). Kept in its own context so only components
// that actually render playback position (NowPlaying's seek bar) re-render
// on tick — everything else reading usePlayerState() would otherwise
// re-render every tick regardless of which fields it actually uses, since
// a single Context re-renders all its consumers when the provided value's
// reference changes.
const PlayerTimeContext = createContext(null);

export const FAVORITES_PLAYLIST_ID = "pl-favorites";
export const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5];

const initialState = {
  library: [],
  albums: [],
  queue: [],
  queueIndex: 0,
  playing: false,
  currentTime: 0,
  duration: 0,
  shuffle: false,
  repeatMode: "off",
  playbackRate: 1.0,
  theme: "glass",
  buttonPack: "modern",
  fontFamily: "inter",
  accentColor: FALLBACK_ACCENT,
  selectedFolderName: null,
  loadingLibrary: false,
  libraryError: null,
  libraryProgress: null,
  pendingFolderConfirm: null,
  eqBands: EQ_FREQUENCIES.map(() => 0),
  eqPreset: "Flat",
  playlists: [{ id: FAVORITES_PLAYLIST_ID, name: "Favourite Tunes", effectId: null, trackIds: [] }],
  studioStatus: null,
  trackOrderStatus: null,
  queueToast: null,
  // Duration picked by the user (minutes) — kept alongside sleepTimerEndsAt
  // purely so the UI can show "Off in 15 min" without re-deriving it.
  sleepTimerMinutes: null,
  // Absolute timestamp (Date.now()-based) the timer expires at — an
  // effect below watches this and pauses playback once it's passed. Using
  // an absolute time rather than a running countdown means the timer stays
  // correct even if the tab/app was backgrounded and JS timers were throttled.
  sleepTimerEndsAt: null,
};

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function reducer(state, action) {
  switch (action.type) {
    case "LOADING_LIBRARY":
      return { ...state, loadingLibrary: true, libraryError: null, libraryProgress: null, pendingFolderConfirm: null };
    case "SET_PENDING_FOLDER_CONFIRM":
      return { ...state, pendingFolderConfirm: action.path };
    case "LIBRARY_SCAN_PROGRESS":
      return { ...state, libraryProgress: { done: action.done, total: action.total } };
    case "LOAD_LIBRARY": {
      const albums = groupIntoAlbums(action.tracks);
      return {
        ...state,
        library: action.tracks,
        albums,
        loadingLibrary: false,
        libraryProgress: null,
        selectedFolderName: action.folderName || state.selectedFolderName,
      };
    }
    case "LIBRARY_ERROR":
      return { ...state, loadingLibrary: false, libraryProgress: null, libraryError: action.message };
    case "SET_QUEUE":
      return { ...state, queue: action.queue, queueIndex: action.index ?? 0, playing: true, currentTime: 0 };
    case "SET_INDEX":
      return { ...state, queueIndex: action.index, playing: true, currentTime: 0 };
    case "TOGGLE_PLAY":
      return { ...state, playing: !state.playing };
    case "SET_PLAYING":
      return { ...state, playing: action.playing };
    case "TICK":
      return { ...state, currentTime: action.currentTime };
    case "SET_DURATION":
      return { ...state, duration: action.duration };
    case "SET_PLAYBACK_RATE":
      return { ...state, playbackRate: action.rate };
    case "TOGGLE_SHUFFLE": {
      const next = !state.shuffle;
      if (state.queue.length === 0) return { ...state, shuffle: next };
      const current = state.queue[state.queueIndex];
      if (next) {
        const rest = state.queue.filter((_, i) => i !== state.queueIndex);
        return { ...state, shuffle: true, queue: [current, ...shuffleArray(rest)], queueIndex: 0 };
      } else {
        const album = state.albums.find((al) => al.tracks.some((t) => t.id === current.id));
        const ordered = album ? album.tracks : state.queue;
        const idx = ordered.findIndex((t) => t.id === current.id);
        return { ...state, shuffle: false, queue: ordered, queueIndex: idx === -1 ? 0 : idx };
      }
    }
    case "RESHUFFLE_QUEUE": {
      if (state.queue.length === 0) return state;
      const current = state.queue[state.queueIndex];
      const rest = state.queue.filter((_, i) => i !== state.queueIndex);
      return { ...state, shuffle: true, queue: [current, ...shuffleArray(rest)], queueIndex: 0, queueToast: "Queue reshuffled" };
    }
    case "CYCLE_REPEAT": {
      const next = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off";
      return { ...state, repeatMode: next };
    }
    case "MOVE_QUEUE_ITEM": {
      const { from, to } = action;
      if (to < 0 || to >= state.queue.length) return state;
      const q = [...state.queue];
      [q[from], q[to]] = [q[to], q[from]];
      let newIndex = state.queueIndex;
      if (from === state.queueIndex) newIndex = to;
      else if (to === state.queueIndex) newIndex = from;
      return { ...state, queue: q, queueIndex: newIndex };
    }
    case "REMOVE_QUEUE_ITEM": {
      if (action.index === state.queueIndex) {
        return { ...state, queueToast: "Can't remove the track that's currently playing" };
      }
      const q = state.queue.filter((_, i) => i !== action.index);
      const newIndex = action.index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
      return { ...state, queue: q, queueIndex: newIndex };
    }
    case "ADD_TO_QUEUE": {
      if (state.queue.length === 0) {
        return { ...state, queue: [action.track], queueIndex: 0, queueToast: `Playing "${action.track.title}"` };
      }
      return {
        ...state,
        queue: [...state.queue, action.track],
        queueToast: `Added "${action.track.title}" to queue`,
      };
    }
    case "PLAY_NEXT": {
      if (state.queue.length === 0) {
        return { ...state, queue: [action.track], queueIndex: 0, playing: true, currentTime: 0, queueToast: `Playing "${action.track.title}"` };
      }
      const q = [...state.queue];
      q.splice(state.queueIndex + 1, 0, action.track);
      return { ...state, queue: q, queueToast: `"${action.track.title}" will play next` };
    }
    case "SET_QUEUE_TOAST":
      return { ...state, queueToast: action.message };
    case "SET_SLEEP_TIMER":
      return { ...state, sleepTimerMinutes: action.minutes, sleepTimerEndsAt: action.endsAt };
    case "CANCEL_SLEEP_TIMER":
      return { ...state, sleepTimerMinutes: null, sleepTimerEndsAt: null };
    case "ADD_TRACK_TO_PLAYLIST": {
      const { playlistId, track } = action;
      const playlist = state.playlists.find((p) => p.id === playlistId);
      if (!playlist) return state;
      if (playlist.trackIds.includes(track.id)) {
        return { ...state, queueToast: `Already in "${playlist.name}"` };
      }
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: [...p.trackIds, track.id] } : p
        ),
        queueToast: `Added to "${playlist.name}"`,
      };
    }
    case "REMOVE_TRACK_FROM_PLAYLIST": {
      const { playlistId, trackId } = action;
      const playlist = state.playlists.find((p) => p.id === playlistId);
      if (!playlist) return state;
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p
        ),
        queueToast: `Removed from "${playlist.name}"`,
      };
    }
    case "REMOVE_TRACKS_FROM_PLAYLIST": {
      const { playlistId, trackIds } = action;
      const playlist = state.playlists.find((p) => p.id === playlistId);
      if (!playlist) return state;
      const idSet = new Set(trackIds);
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => !idSet.has(id)) } : p
        ),
        queueToast: `Removed from "${playlist.name}"`,
      };
    }
    case "ADD_TRACKS_TO_PLAYLIST": {
      const { playlistId, tracks } = action;
      const playlist = state.playlists.find((p) => p.id === playlistId);
      if (!playlist) return state;
      const newIds = tracks.filter((t) => !playlist.trackIds.includes(t.id)).map((t) => t.id);
      if (newIds.length === 0) {
        return { ...state, queueToast: `All already in "${playlist.name}"` };
      }
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: [...p.trackIds, ...newIds] } : p
        ),
        queueToast: `Added ${newIds.length} track${newIds.length === 1 ? "" : "s"} to "${playlist.name}"`,
      };
    }
    case "CREATE_PLAYLIST_WITH_TRACK": {
      const { name, track } = action;
      const id = `pl-user-${Date.now()}`;
      return {
        ...state,
        playlists: [...state.playlists, { id, name, effectId: null, trackIds: track ? [track.id] : [] }],
        queueToast: track ? `Created "${name}" and added the track` : `Created "${name}"`,
      };
    }
    case "SAVE_QUEUE_AS_PLAYLIST": {
      const { name } = action;
      if (state.queue.length === 0) return { ...state, queueToast: "Queue is empty — nothing to save" };
      const id = `pl-user-${Date.now()}`;
      const trackIds = [...new Set(state.queue.map((t) => t.id))];
      return {
        ...state,
        playlists: [...state.playlists, { id, name, effectId: null, trackIds }],
        queueToast: `Saved queue as "${name}"`,
      };
    }
    case "SET_EQ_BAND": {
      const bands = [...state.eqBands];
      bands[action.index] = action.value;
      return { ...state, eqBands: bands, eqPreset: "Custom" };
    }
    case "SET_EQ_PRESET":
      return { ...state, eqBands: [...action.bands], eqPreset: action.name };
    case "SET_STUDIO_STATUS":
      return { ...state, studioStatus: action.status };
    case "ADD_RENDERED_TRACK": {
      const { track, effectId, effectLabel } = action;
      const library = [...state.library, track];
      let playlists = state.playlists;
      const existing = playlists.find((p) => p.effectId === effectId);
      if (existing) {
        playlists = playlists.map((p) =>
          p.id === existing.id ? { ...p, trackIds: [...p.trackIds, track.id] } : p
        );
      } else {
        playlists = [
          ...playlists,
          { id: `pl-${effectId}`, name: effectLabel, effectId, trackIds: [track.id] },
        ];
      }
      return { ...state, library, playlists, studioStatus: null };
    }
    case "RENAME_PLAYLIST":
      return {
        ...state,
        playlists: state.playlists.map((p) => (p.id === action.id ? { ...p, name: action.name } : p)),
      };
    case "SET_TRACK_ORDER_STATUS":
      return { ...state, trackOrderStatus: action.status };
    case "APPLY_TRACK_ORDER": {
      const library = state.library.map((t) => {
        if (action.updates[t.id] !== undefined) {
          return { ...t, track: action.updates[t.id], trackConfirmed: true };
        }
        if (action.albumTrackIds?.includes(t.id)) {
          return { ...t, trackConfirmed: false };
        }
        return t;
      });
      return { ...state, library, albums: groupIntoAlbums(library), trackOrderStatus: null };
    }
    case "SET_THEME":
      return { ...state, theme: action.theme };
    case "SET_BUTTON_PACK":
      return { ...state, buttonPack: action.pack };
    case "SET_FONT_FAMILY":
      return { ...state, fontFamily: action.fontId };
    case "SET_ACCENT_COLOR":
      return { ...state, accentColor: action.color };
    case "SET_ALBUM_COVER": {
      const { trackIds, cover } = action;
      const idSet = new Set(trackIds);
      const library = state.library.map((t) => (idSet.has(t.id) ? { ...t, cover } : t));
      return { ...state, library, albums: groupIntoAlbums(library) };
    }
    case "UPDATE_TRACK_METADATA": {
      const { trackId, updates } = action;
      const library = state.library.map((t) => {
        if (t.id !== trackId) return t;
        const next = { ...t, ...updates };
        if (updates.album !== undefined) {
          next.hasAlbumTag = true;
          next.albumKey = normalizeKey(updates.album);
        }
        if (updates.track !== undefined) {
          next.trackConfirmed = true;
        }
        return next;
      });
      return { ...state, library, albums: groupIntoAlbums(library) };
    }
    default:
      return state;
  }
}

export function PlayerProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const engineRef = useRef(null);
  const accentCacheRef = useRef(new Map());
  // Always-current copy of `actions` (whose methods are recreated every
  // render) — MediaSession action handlers are registered once and need
  // to call into whatever "next"/"previous"/etc. currently do, not a
  // stale first-render closure.
  const actionsRef = useRef(null);
  // Listening-stats accounting: how many real seconds we've accumulated
  // for the currently-loaded track since the last flush to localStorage.
  const listenRef = useRef({ trackId: null, lastTime: 0, pendingSeconds: 0 });

  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.crossOrigin = "anonymous";
  }

  const ensureEngine = useCallback(() => {
    if (!engineRef.current && audioRef.current) {
      engineRef.current = new AudioEngine(audioRef.current);
      engineRef.current.setAllBands(state.eqBands);
    }
    if (engineRef.current) engineRef.current.resume();
    return engineRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flushListen() {
    const l = listenRef.current;
    if (l.trackId && l.pendingSeconds > 0) {
      recordListen(l.trackId, l.pendingSeconds);
    }
    l.pendingSeconds = 0;
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const track = state.queue[state.queueIndex];
    if (!track) return;

    // Flush whatever we'd accumulated for the previous track before
    // switching, then start a fresh accounting window for this one — plus
    // a 1-second "start" marker so every play attempt shows up in
    // lifetime/recently-played stats even if it's skipped almost
    // immediately.
    flushListen();
    listenRef.current = { trackId: track.id, lastTime: 0, pendingSeconds: 0 };
    if (state.playing) recordListen(track.id, 1);

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(track.file);
    objectUrlRef.current = url;
    audio.src = url;
    audio.playbackRate = state.playbackRate;
    if (state.playing) {
      ensureEngine();
      audio.play().catch(() => {});
    }
  }, [state.queueIndex, state.queue]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.playing) {
      ensureEngine();
      audio.play().catch(() => {});
    } else {
      audio.pause();
      flushListen();
    }
  }, [state.playing]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = state.playbackRate;
  }, [state.playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const l = listenRef.current;
      const now = audio.currentTime;
      const delta = now - l.lastTime;
      // Ignore seeks/loops (negative or implausibly large jumps) — only
      // count genuine forward playback time.
      if (delta > 0 && delta < 5) l.pendingSeconds += delta;
      l.lastTime = now;
      if (l.pendingSeconds >= 10) flushListen();
      dispatch({ type: "TICK", currentTime: now });
      if (audio.duration) {
        // Powers the scrub bar on the lock screen/notification — settled
        // with .catch() since it can reject on transient inconsistent
        // values (e.g. position momentarily exceeding duration mid-seek).
        MediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        }).catch(() => {});
      }
    };
    const onLoaded = () => dispatch({ type: "SET_DURATION", duration: audio.duration || 0 });
    const onEnded = () => actions.next();
    // The state.playing effect drives audio.play()/pause() one-way, but
    // the browser can also pause/resume on its own — audio focus loss
    // (e.g. a phone call), headphone unplug ("becoming noisy"), or a
    // lock-screen/notification media control tap all pause the element
    // directly without going through our dispatch. Without these,
    // state.playing goes stale: the button would still show "playing"
    // while the audio is actually silent.
    const onPlay = () => dispatch({ type: "SET_PLAYING", playing: true });
    const onPause = () => dispatch({ type: "SET_PLAYING", playing: false });
    const onError = () => {
      const track = state.queue[state.queueIndex];
      dispatch({ type: "SET_PLAYING", playing: false });
      dispatch({
        type: "SET_QUEUE_TOAST",
        message: `Couldn't play "${track?.title || "this track"}" — the file may be corrupted or an unsupported format.`,
      });
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repeatMode, state.queueIndex, state.queue.length]);

  // Flush on tab close so the last few seconds of a session aren't lost.
  useEffect(() => {
    const handler = () => flushListen();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Lock screen / notification media controls, and hardware media buttons
  // (wired + Bluetooth) — via @capgo/capacitor-media-session's native
  // MediaSessionCompat + MediaButtonReceiver + foreground service. Plain
  // android.webkit.WebView does NOT implement the native side of
  // navigator.mediaSession on its own — no real system MediaSession, no
  // audio focus, no hardware-key routing. That integration lives in
  // Chrome-the-browser-app's own Java layer, not in the WebView engine
  // third-party apps embed — confirmed the hard way: hardware buttons did
  // nothing despite the Web MediaSession API surface (metadata,
  // playbackState, action handlers) being fully and correctly wired. This
  // plugin's JS API mirrors navigator.mediaSession closely and falls back
  // to the real Web API on non-native builds.
  useEffect(() => {
    MediaSession.setActionHandler({ action: "play" }, () => actionsRef.current.play()).catch(() => {});
    MediaSession.setActionHandler({ action: "pause" }, () => actionsRef.current.pause()).catch(() => {});
    MediaSession.setActionHandler({ action: "previoustrack" }, () => actionsRef.current.previous()).catch(() => {});
    MediaSession.setActionHandler({ action: "nexttrack" }, () => actionsRef.current.next()).catch(() => {});
    MediaSession.setActionHandler({ action: "seekto" }, (details) => {
      if (details.seekTime != null) actionsRef.current.seek(details.seekTime);
    }).catch(() => {});
    return () => {
      MediaSession.setActionHandler({ action: "play" }, null).catch(() => {});
      MediaSession.setActionHandler({ action: "pause" }, null).catch(() => {});
      MediaSession.setActionHandler({ action: "previoustrack" }, null).catch(() => {});
      MediaSession.setActionHandler({ action: "nexttrack" }, null).catch(() => {});
      MediaSession.setActionHandler({ action: "seekto" }, null).catch(() => {});
    };
  }, []);

  // "none" until a track has actually been loaded — otherwise this fires
  // on cold mount (state.playing starts false → "paused"), and "paused"
  // counts as active playback to the plugin's native service, starting
  // the foreground service and showing an empty notification before
  // anything has ever played.
  const hasCurrentTrack = Boolean(state.queue[state.queueIndex]);
  useEffect(() => {
    MediaSession.setPlaybackState({
      playbackState: !hasCurrentTrack ? "none" : state.playing ? "playing" : "paused",
    }).catch(() => {});
  }, [state.playing, hasCurrentTrack]);

  const currentTrackId = state.queue[state.queueIndex]?.id;
  useEffect(() => {
    const track = state.queue[state.queueIndex];
    if (!track) {
      dispatch({ type: "SET_ACCENT_COLOR", color: FALLBACK_ACCENT });
      return;
    }
    const cached = accentCacheRef.current.get(track.id);
    if (cached) {
      dispatch({ type: "SET_ACCENT_COLOR", color: cached });
      return;
    }
    let cancelled = false;
    extractAccentColor(track.cover).then((color) => {
      accentCacheRef.current.set(track.id, color);
      if (!cancelled) dispatch({ type: "SET_ACCENT_COLOR", color });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId]);

  useEffect(() => {
    const track = state.queue[state.queueIndex];
    if (!track) return;
    MediaSession.setMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      // track.cover is always a blob: object URL in this app (see
      // coverObjectUrlFromBytes in audio/metadata.js) — the plugin's
      // native side can only fetch http(s):/data: URLs, not blob:, so
      // lock-screen/notification artwork won't actually render from this
      // until covers are exposed some other way. Known limitation, not
      // addressed here — title/artist/album and the controls themselves
      // are unaffected.
      artwork: track.cover ? [{ src: track.cover, sizes: "512x512", type: "image/jpeg" }] : [],
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId]);

  useEffect(() => {
    if (!state.queueToast) return;
    const t = setTimeout(() => dispatch({ type: "SET_QUEUE_TOAST", message: null }), 2200);
    return () => clearTimeout(t);
  }, [state.queueToast]);

  // Sleep timer expiry — a single setTimeout keyed off the absolute end
  // timestamp rather than a ticking countdown, so nothing needs to poll
  // and the timer still fires at the right wall-clock time even if the
  // effect re-runs (e.g. after a background/foreground cycle throttled JS
  // timers). Pauses via the same actionsRef.current.pause() the
  // MediaSession "pause" handler uses, not a raw dispatch, so the sleep
  // timer never bypasses whatever "pause" ends up meaning elsewhere.
  useEffect(() => {
    if (!state.sleepTimerEndsAt) return;
    const ms = state.sleepTimerEndsAt - Date.now();
    const fire = () => {
      actionsRef.current.pause();
      dispatch({ type: "CANCEL_SLEEP_TIMER" });
    };
    if (ms <= 0) {
      fire();
      return;
    }
    const t = setTimeout(fire, ms);
    return () => clearTimeout(t);
  }, [state.sleepTimerEndsAt]);

  const pickFolder = useCallback(async (fileList) => {
    dispatch({ type: "LOADING_LIBRARY" });
    const tracks = await parseLibrary(fileList);
    const folderName = fileList[0]?.webkitRelativePath?.split("/")[0] || "Music Downloads";
    dispatch({ type: "LOAD_LIBRARY", tracks, folderName });
  }, []);

  // Any explicit scan — a manual tap or confirming the first-run prompt —
  // counts as the user approving the current folder path, so future
  // launches can auto-scan without asking again.
  const pickNativeFolder = useCallback(async () => {
    dispatch({ type: "LOADING_LIBRARY" });
    markFolderConfirmedOnce();
    try {
      const { files, folderPath } = await readNativeFolderAsFiles((done, total) =>
        dispatch({ type: "LIBRARY_SCAN_PROGRESS", done, total })
      );
      const tracks = await parseLibrary(files);
      dispatch({ type: "LOAD_LIBRARY", tracks, folderName: folderPath });
    } catch (err) {
      dispatch({ type: "LIBRARY_ERROR", message: err.message || "Couldn't read your music folder." });
    }
  }, []);

  // Request storage permission as soon as the app launches rather than
  // waiting for the user to tap "Choose your music folder". If a folder
  // has already been explicitly confirmed in a previous session, rescan
  // immediately so reopening the app shows the library directly. On a
  // first-ever run (nothing confirmed yet), don't silently scan a
  // guessed/default path — surface it via pendingFolderConfirm and wait
  // for one explicit tap.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      const granted = await ensureStoragePermission();
      if (!granted) return;
      const confirmed = await hasConfirmedFolderOnce();
      if (confirmed) {
        pickNativeFolder();
      } else {
        const path = await getMusicFolderPath();
        dispatch({ type: "SET_PENDING_FOLDER_CONFIRM", path });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playAlbumFromTrack = useCallback(
    (album, track) => {
      const startIdx = album.tracks.findIndex((t) => t.id === track.id);
      if (state.shuffle) {
        const rest = album.tracks.filter((t) => t.id !== track.id);
        dispatch({ type: "SET_QUEUE", queue: [track, ...shuffleArray(rest)], index: 0 });
      } else {
        dispatch({ type: "SET_QUEUE", queue: album.tracks, index: startIdx === -1 ? 0 : startIdx });
      }
    },
    [state.shuffle]
  );

  const playPlaylist = useCallback(
    (playlist, track) => {
      const tracks = playlist.trackIds
        .map((id) => state.library.find((t) => t.id === id))
        .filter(Boolean);
      const startTrack = track || tracks[0];
      if (!startTrack) return;
      const startIdx = tracks.findIndex((t) => t.id === startTrack.id);
      if (state.shuffle) {
        const rest = tracks.filter((t) => t.id !== startTrack.id);
        dispatch({ type: "SET_QUEUE", queue: [startTrack, ...shuffleArray(rest)], index: 0 });
      } else {
        dispatch({ type: "SET_QUEUE", queue: tracks, index: startIdx === -1 ? 0 : startIdx });
      }
    },
    [state.shuffle, state.library]
  );

  // Generic "play this arbitrary list of tracks" — backs Play Now's
  // carousels (Never Played, Most Played, Recently Played/Added,
  // Favorites, Popular Albums) and Instant Mix, none of which are a real
  // album/playlist object.
  const playTrackList = useCallback((tracks, { shuffle: shuffleIt = false } = {}) => {
    if (!tracks || tracks.length === 0) return;
    const ordered = shuffleIt ? shuffleArray(tracks) : tracks;
    dispatch({ type: "SET_QUEUE", queue: ordered, index: 0 });
  }, []);

  // Same idea as playAlbumFromTrack/playPlaylist, but for an arbitrary track
  // list — tapping one card in a Play Now carousel (e.g. "Recently Played")
  // should start there and continue through the rest of that same list,
  // not just play that one track in isolation.
  const playTrackListFrom = useCallback(
    (tracks, track) => {
      if (!tracks || tracks.length === 0) return;
      const startIdx = tracks.findIndex((t) => t.id === track.id);
      if (state.shuffle) {
        const rest = tracks.filter((t) => t.id !== track.id);
        dispatch({ type: "SET_QUEUE", queue: [track, ...shuffleArray(rest)], index: 0 });
      } else {
        dispatch({ type: "SET_QUEUE", queue: tracks, index: startIdx === -1 ? 0 : startIdx });
      }
    },
    [state.shuffle]
  );

  const actions = {
    pickFolder,
    pickNativeFolder,
    playAlbumFromTrack,
    playPlaylist,
    playTrackList,
    playTrackListFrom,
    togglePlay: () => dispatch({ type: "TOGGLE_PLAY" }),
    // Explicit play/pause (rather than toggle) for callers that know which
    // state they want regardless of current state — e.g. MediaSession's
    // "play"/"pause" action handlers, which the OS calls directly from the
    // lock screen/notification.
    play: () => dispatch({ type: "SET_PLAYING", playing: true }),
    pause: () => dispatch({ type: "SET_PLAYING", playing: false }),
    seek: (time) => {
      if (audioRef.current) audioRef.current.currentTime = time;
      dispatch({ type: "TICK", currentTime: time });
    },
    next: () => {
      const { queue, queueIndex, repeatMode } = state;
      if (queue.length === 0) return;
      if (repeatMode === "one") {
        if (audioRef.current) audioRef.current.currentTime = 0;
        dispatch({ type: "SET_PLAYING", playing: true });
        return;
      }
      let nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === "all") nextIndex = 0;
        else { dispatch({ type: "SET_PLAYING", playing: false }); return; }
      }
      dispatch({ type: "SET_INDEX", index: nextIndex });
    },
    previous: () => {
      const { queue, queueIndex, repeatMode } = state;
      if (queue.length === 0) return;
      let prevIndex = queueIndex - 1;
      if (prevIndex < 0) prevIndex = repeatMode === "all" ? queue.length - 1 : 0;
      dispatch({ type: "SET_INDEX", index: prevIndex });
    },
    toggleShuffle: () => dispatch({ type: "TOGGLE_SHUFFLE" }),
    reshuffleQueue: () => dispatch({ type: "RESHUFFLE_QUEUE" }),
    cycleRepeat: () => dispatch({ type: "CYCLE_REPEAT" }),
    setPlaybackRate: (rate) => dispatch({ type: "SET_PLAYBACK_RATE", rate }),
    moveQueueItem: (from, to) => dispatch({ type: "MOVE_QUEUE_ITEM", from, to }),
    removeQueueItem: (index) => dispatch({ type: "REMOVE_QUEUE_ITEM", index }),
    jumpToQueueIndex: (index) => dispatch({ type: "SET_INDEX", index }),
    addToQueue: (track) => dispatch({ type: "ADD_TO_QUEUE", track }),
    playNext: (track) => dispatch({ type: "PLAY_NEXT", track }),
    addTrackToPlaylist: (playlistId, track) => dispatch({ type: "ADD_TRACK_TO_PLAYLIST", playlistId, track }),
    addTracksToPlaylist: (playlistId, tracks) => dispatch({ type: "ADD_TRACKS_TO_PLAYLIST", playlistId, tracks }),
    removeTrackFromPlaylist: (playlistId, trackId) => dispatch({ type: "REMOVE_TRACK_FROM_PLAYLIST", playlistId, trackId }),
    removeTracksFromPlaylist: (playlistId, trackIds) => dispatch({ type: "REMOVE_TRACKS_FROM_PLAYLIST", playlistId, trackIds }),
    createPlaylistWithTrack: (name, track) => dispatch({ type: "CREATE_PLAYLIST_WITH_TRACK", name, track }),
    saveQueueAsPlaylist: (name) => dispatch({ type: "SAVE_QUEUE_AS_PLAYLIST", name }),
    setTheme: (theme) => dispatch({ type: "SET_THEME", theme }),
    setButtonPack: (pack) => dispatch({ type: "SET_BUTTON_PACK", pack }),
    setFontFamily: (fontId) => {
      loadFont(fontId);
      dispatch({ type: "SET_FONT_FAMILY", fontId });
    },
    updateTrackMetadata: (trackId, updates) =>
      dispatch({ type: "UPDATE_TRACK_METADATA", trackId, updates }),
    setAlbumCover: (trackIds, cover) => dispatch({ type: "SET_ALBUM_COVER", trackIds, cover }),
    setEqBand: (index, value) => {
      if (engineRef.current) engineRef.current.setBandGain(index, value);
      dispatch({ type: "SET_EQ_BAND", index, value });
    },
    setEqPreset: (name) => {
      const bands = EQ_PRESETS[name] || EQ_PRESETS.Flat;
      if (engineRef.current) engineRef.current.setAllBands(bands);
      dispatch({ type: "SET_EQ_PRESET", name, bands });
    },
    renamePlaylist: (id, name) => dispatch({ type: "RENAME_PLAYLIST", id, name }),
    setSleepTimer: (minutes) =>
      dispatch({ type: "SET_SLEEP_TIMER", minutes, endsAt: Date.now() + minutes * 60000 }),
    cancelSleepTimer: () => dispatch({ type: "CANCEL_SLEEP_TIMER" }),
    fixAlbumTrackOrder: async (album) => {
      dispatch({ type: "SET_TRACK_ORDER_STATUS", status: "Looking up track order…" });
      const result = await fetchCanonicalTrackOrder(album.title, album.artist);
      if (!result.ok) {
        dispatch({
          type: "SET_TRACK_ORDER_STATUS",
          status: {
            error: result.offline
              ? "You're offline — connect to fix track order."
              : result.notFound
              ? "Couldn't find this album on MusicBrainz."
              : "Lookup failed — try again later.",
          },
        });
        return { ok: false };
      }
      const updates = matchTracksToOrder(album.tracks, result.order);
      const matchedCount = Object.keys(updates).length;
      if (matchedCount === 0) {
        dispatch({ type: "SET_TRACK_ORDER_STATUS", status: { error: "Found the album, but couldn't confidently match any track titles." } });
        return { ok: false };
      }
      dispatch({ type: "APPLY_TRACK_ORDER", updates, albumTrackIds: album.tracks.map((t) => t.id) });
      return { ok: true, matched: matchedCount, total: album.tracks.length };
    },
    renderStudioEffect: async (sourceTrack, effectId, format = "mp3") => {
      try {
        dispatch({ type: "SET_STUDIO_STATUS", status: "Decoding source file…" });
        const { audioBuffer, suggestedFileName, effectDef } = await renderEffectOffline(
          sourceTrack,
          effectId,
          (status) => dispatch({ type: "SET_STUDIO_STATUS", status })
        );

        dispatch({ type: "SET_STUDIO_STATUS", status: `Encoding ${format.toUpperCase()}…` });
        const meta = {
          title: `${sourceTrack.title} (${effectDef.label})`,
          artist: sourceTrack.artist,
          album: effectDef.label,
          track: sourceTrack.track,
        };
        const blob =
          format === "wav"
            ? audioBufferToWavBlob(audioBuffer, meta)
            : await audioBufferToMp3Blob(audioBuffer, meta);

        const fileName = suggestedFileName.replace(/\.wav$/, format === "wav" ? ".wav" : ".mp3");
        // Blob has no settable .name — wrap it in a real File so
        // track.file.name works everywhere else the same as picked files.
        const renderedFile = new File([blob], fileName, { type: blob.type });

        const track = {
          id: `studio-${effectId}-${sourceTrack.id}-${Date.now()}`,
          file: renderedFile,
          title: meta.title,
          artist: meta.artist,
          album: effectDef.label,
          track: sourceTrack.track || 0,
          year: sourceTrack.year,
          cover: sourceTrack.cover,
          addedAt: Date.now(),
          isStudioRender: true,
          sourceTrackId: sourceTrack.id,
        };

        dispatch({ type: "ADD_RENDERED_TRACK", track, effectId, effectLabel: effectDef.label });
        return { ok: true, track };
      } catch (err) {
        dispatch({ type: "SET_STUDIO_STATUS", status: { error: err.message || "Render failed" } });
        return { ok: false, error: err };
      }
    },
  };
  actionsRef.current = actions;

  const timeValue = useMemo(
    () => ({ currentTime: state.currentTime, duration: state.duration }),
    [state.currentTime, state.duration]
  );
  // Deliberately excludes currentTime/duration from the dependency list —
  // this must NOT recompute on a tick-only dispatch, that's the whole
  // point of the split. Every other field needs to be listed explicitly;
  // an omission here would mean a real update silently fails to propagate.
  const restStateValue = useMemo(() => {
    const { currentTime, duration, ...rest } = state;
    return rest;
  }, [
    state.library, state.albums, state.queue, state.queueIndex, state.playing,
    state.shuffle, state.repeatMode, state.playbackRate, state.theme, state.buttonPack,
    state.fontFamily, state.accentColor, state.selectedFolderName, state.loadingLibrary,
    state.libraryError, state.libraryProgress, state.pendingFolderConfirm, state.eqBands,
    state.eqPreset, state.playlists, state.studioStatus, state.trackOrderStatus, state.queueToast,
    state.sleepTimerMinutes, state.sleepTimerEndsAt,
  ]);

  return (
    <PlayerStateContext.Provider value={restStateValue}>
      <PlayerTimeContext.Provider value={timeValue}>
        <PlayerActionsContext.Provider value={actions}>{children}</PlayerActionsContext.Provider>
      </PlayerTimeContext.Provider>
    </PlayerStateContext.Provider>
  );
}

export function usePlayerState() {
  return useContext(PlayerStateContext);
}
// currentTime/duration only — see PlayerTimeContext comment above for why
// these live separately from the rest of usePlayerState().
export function usePlayerTime() {
  return useContext(PlayerTimeContext);
}
export function usePlayerActions() {
  return useContext(PlayerActionsContext);
}

