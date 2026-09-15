// src/store/PlayerContext.jsx
// Central player state + real HTML5 Audio playback engine.
import React, { createContext, useContext, useEffect, useReducer, useRef, useCallback, useMemo } from "react";
import { parseLibrary, groupIntoAlbums, normalizeKey, albumIdForTrack, coverObjectUrlFromBytes } from "../audio/metadata";
import { Capacitor } from "@capacitor/core";
import {
  scanNativeFolder,
  readNativeTrackObjectUrl,
  deleteNativeTrack,
  ensureStoragePermission,
  getMusicFolderPath,
  hasConfirmedFolderOnce,
  markFolderConfirmedOnce,
} from "../audio/nativeFolder";
import {
  loadLibrary as loadCachedLibrary,
  saveLibrary as saveCachedLibrary,
  saveCoverOverride as persistCoverOverride,
  clearCoverOverride as removePersistedCoverOverride,
  loadCoverOverrides,
  savePlaylists as persistPlaylists,
  loadPlaylists as loadCachedPlaylists,
  savePlaybackState as persistPlaybackState,
  loadPlaybackState as loadCachedPlaybackState,
  saveSettings as persistSettings,
  loadSettings as loadCachedSettings,
} from "../audio/libraryCache";
import { AudioEngine, EQ_PRESETS, EQ_FREQUENCIES } from "../audio/engine";
import { renderStudioEffect as renderEffectOffline } from "../audio/studioEffects";
import { audioBufferToWavBlob } from "../audio/wav";
import { audioBufferToMp3Blob } from "../audio/mp3";
import { fetchCanonicalTrackOrder, matchTracksToOrder } from "../online/trackOrder";
import { extractAccentColor, FALLBACK_ACCENT } from "../utils/accentColor";
import { recordListen } from "../utils/listeningStats";
import { loadFont } from "../utils/fonts";
import { MediaSession } from "@capgo/capacitor-media-session";
import { NoisyAudio } from "../utils/noisyAudio";
import { AudioFocus } from "../utils/audioFocus";
import { PlaybackWakeLock } from "../utils/playbackWakeLock";
import { ensureNotificationPermission } from "../utils/notificationPermission";
import { armBackgroundWatchdog, checkAndClearBackgroundKillMarker } from "../utils/backgroundPlaybackWatchdog";

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
// MediaSession.setPositionState() crosses the native bridge into Android's
// real MediaSessionCompat, which pushes the session to the top of the stack
// and re-renders the lock-screen/notification on every call. Calling it on
// every "timeupdate" tick (several times a second, see above) fired dozens
// of native session updates per second — logcat showed Android's own
// NotificationService rate-limiter ("Shedding") dropping our updates as a
// result, and the resulting churn is suspected to have contributed to
// playback jank. Position sync is throttled to this interval during normal
// playback; play/pause/seek/track-change still update immediately (via
// setPlaybackState/setMetadata, which aren't on the tick path, and via the
// seek/track-change jump detection in the timeupdate handler itself).
const POSITION_SYNC_INTERVAL_MS = 1500;
// See the audio-focus listener effect for the full story — a loss/
// lossTransient arriving less than this long after our own
// AudioFocus.requestFocus() call is assumed to be Chromium's own internal
// focus request evicting ours, not a real interruption (observed ~2.5s
// gap via logcat; this leaves comfortable margin either side).
const SELF_COLLISION_GUARD_MS = 4000;

export const FAVORITES_PLAYLIST_ID = "pl-favorites";
export const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5];

// How many tracks a tap in the Tracks list / search results queues up —
// the tapped track plus this many minus one drawn at random from whatever
// pool was on screen. See playRandomMixFrom.
export const RANDOM_QUEUE_SIZE = 100;

// How long after a headset-driven "next track" a play/pause action is
// still read as the tail of a triple-click rather than a separate press.
// Android's own double-tap window (ViewConfiguration.getDoubleTapTimeout)
// is 300ms, and the third click's play/pause only fires after that window
// expires, so this has to comfortably exceed it — see the media-session
// effect for the full sequence.
const TRIPLE_CLICK_WINDOW_MS = 700;

// Playlist cover overrides live in the same coverOverrides map/IndexedDB
// store as album cover overrides (see SET_ALBUM_COVER_OVERRIDE) — this
// prefix just keeps a playlist id from ever colliding with an album key
// (a normalized album title, or "single::<trackId>").
export function playlistCoverKey(playlistId) {
  return `playlist:${playlistId}`;
}

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
  // { [albumId]: objectUrl } — user-chosen covers that override the
  // embedded/derived one. Loaded from IndexedDB once on launch, before any
  // LOAD_LIBRARY dispatch, so a rescan or cache hydration never has a
  // chance to show the embedded cover before the override reasserts.
  coverOverrides: {},
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
  // Set once, on cold launch, if the previous session's playback appears
  // to have been killed by the OS while backgrounded (see
  // backgroundPlaybackWatchdog.js) rather than just paused.
  backgroundKillNotice: false,
};

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Overlays `overrides` ({ [albumId]: objectUrl }) onto `tracks`, only
// touching tracks whose album actually has an override — cheap no-op for
// the common case where overrides is empty or unrelated to most tracks.
function applyCoverOverrides(tracks, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return tracks;
  return tracks.map((t) => {
    const override = overrides[albumIdForTrack(t)];
    return override && t.cover !== override ? { ...t, cover: override } : t;
  });
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
      // Freshly-scanned or cache-hydrated tracks always carry their
      // embedded cover — reapply any user overrides on top so a rescan or
      // a later launch doesn't silently drop back to the embedded art.
      const library = applyCoverOverrides(action.tracks, state.coverOverrides);
      const albums = groupIntoAlbums(library);
      return {
        ...state,
        library,
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
    case "SET_BACKGROUND_KILL_NOTICE":
      return { ...state, backgroundKillNotice: action.value };
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
    // Applied once on native launch, after hydrating from IndexedDB —
    // replaces the default Favourite-Tunes-only playlists with whatever
    // was actually saved last session.
    case "SET_PLAYLISTS":
      return { ...state, playlists: action.playlists };
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
    // Applied once on launch from the persisted settings record (see
    // loadSettings). Only the appearance keys are read out of it, and each
    // only if actually present, so a record written by an older/newer
    // build can never inject unrelated or missing fields into state.
    case "HYDRATE_SETTINGS": {
      const saved = action.settings || {};
      return {
        ...state,
        theme: saved.theme ?? state.theme,
        buttonPack: saved.buttonPack ?? state.buttonPack,
        fontFamily: saved.fontFamily ?? state.fontFamily,
      };
    }
    case "SET_THEME":
      return { ...state, theme: action.theme };
    case "SET_BUTTON_PACK":
      return { ...state, buttonPack: action.pack };
    case "SET_FONT_FAMILY":
      return { ...state, fontFamily: action.fontId };
    case "SET_ACCENT_COLOR":
      return { ...state, accentColor: action.color };
    // Applied once on launch after loading every persisted override from
    // IndexedDB — replaces coverOverrides wholesale and reapplies to
    // whatever's currently in state.library (which may already be
    // populated from cache hydration, or still empty pending a scan;
    // either way LOAD_LIBRARY also reapplies coverOverrides, so ordering
    // between the two doesn't matter for correctness).
    case "SET_COVER_OVERRIDES": {
      const coverOverrides = action.overrides;
      const library = applyCoverOverrides(state.library, coverOverrides);
      return { ...state, coverOverrides, library, albums: groupIntoAlbums(library) };
    }
    case "SET_ALBUM_COVER_OVERRIDE": {
      const { albumId, cover } = action;
      const coverOverrides = { ...state.coverOverrides, [albumId]: cover };
      const library = state.library.map((t) => (albumIdForTrack(t) === albumId ? { ...t, cover } : t));
      return { ...state, coverOverrides, library, albums: groupIntoAlbums(library) };
    }
    case "CLEAR_ALBUM_COVER_OVERRIDE": {
      const { albumId } = action;
      const coverOverrides = { ...state.coverOverrides };
      delete coverOverrides[albumId];
      // Only the affected album's tracks need their cover recomputed —
      // regenerating object URLs for the whole library on every unrelated
      // action would leak blob URLs for no reason.
      const library = state.library.map((t) => {
        if (albumIdForTrack(t) !== albumId) return t;
        const cover = t.coverBytes ? coverObjectUrlFromBytes(t.coverBytes, t.coverFormat) : null;
        return { ...t, cover };
      });
      return { ...state, coverOverrides, library, albums: groupIntoAlbums(library) };
    }
    // Playlists have no embedded "original" art to fall back to (unlike
    // albums), so there's no CLEAR_ALBUM_COVER_OVERRIDE-style rewrite of
    // state.library here — just the override map itself.
    case "SET_PLAYLIST_COVER_OVERRIDE": {
      const coverOverrides = { ...state.coverOverrides, [playlistCoverKey(action.playlistId)]: action.cover };
      return { ...state, coverOverrides };
    }
    case "CLEAR_PLAYLIST_COVER_OVERRIDE": {
      const coverOverrides = { ...state.coverOverrides };
      delete coverOverrides[playlistCoverKey(action.playlistId)];
      return { ...state, coverOverrides };
    }
    // Permanent delete (see actions.deleteTrack) — by the time this
    // dispatches, the real file is already gone from disk, so this just
    // scrubs every place the track could still be referenced in memory:
    // the library/albums (groupIntoAlbums naturally drops an album that
    // has no tracks left), every playlist's trackIds (Favourites
    // included), and the queue (adjusting queueIndex for whatever was
    // removed ahead of it, same idea as REMOVE_QUEUE_ITEM).
    case "DELETE_TRACK": {
      const { trackId } = action;
      const library = state.library.filter((t) => t.id !== trackId);
      const albums = groupIntoAlbums(library);
      const playlists = state.playlists.map((p) =>
        p.trackIds.includes(trackId) ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p
      );
      const wasCurrent = state.queue[state.queueIndex]?.id === trackId;
      const removedBeforeCurrent = state.queue
        .slice(0, state.queueIndex)
        .filter((t) => t.id === trackId).length;
      const queue = state.queue.filter((t) => t.id !== trackId);
      let queueIndex = state.queueIndex - removedBeforeCurrent;
      if (queueIndex >= queue.length) queueIndex = Math.max(0, queue.length - 1);
      return {
        ...state,
        library,
        albums,
        playlists,
        queue,
        queueIndex,
        playing: queue.length === 0 ? false : state.playing,
        currentTime: wasCurrent ? 0 : state.currentTime,
      };
    }
    // A decision made on the "Possibly not music" review screen (see
    // actions.reviewTrack) — "confirmed" makes it a normal library track,
    // "excluded" hides it the same way a hard-filtered voice note is
    // hidden, and null (undo) puts it back up for review. Only ever
    // touches state.library's own reviewStatus field; the file on disk is
    // untouched either way, unlike DELETE_TRACK above.
    case "REVIEW_TRACK": {
      const library = state.library.map((t) =>
        t.id === action.trackId ? { ...t, reviewStatus: action.decision } : t
      );
      return { ...state, library, albums: groupIntoAlbums(library) };
    }
    // Restores a queue/position saved by a previous session (see
    // savePlaybackState in libraryCache.js) — resolved against
    // state.library (already updated by the LOAD_LIBRARY dispatched just
    // before this one) rather than whatever the launch effect's stale
    // closure captured, and silently drops any track that no longer
    // resolves (deleted/renamed since the save), same as playlist
    // restoration already does. Deliberately leaves `playing` false —
    // this restores where the user left off, not autoplay.
    case "RESTORE_PLAYBACK_STATE": {
      const queue = action.trackIds.map((id) => state.library.find((t) => t.id === id)).filter(Boolean);
      if (queue.length === 0) return state;
      const queueIndex = Math.min(Math.max(action.index, 0), queue.length - 1);
      return { ...state, queue, queueIndex, currentTime: action.position || 0 };
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
  const engineRef = useRef(null);
  // Object URLs for the current track and the couple prefetched ahead of
  // it — id -> Promise<string|null> so concurrent lookups for the same
  // track share one native read instead of firing it twice. Entries fall
  // out of the "current + next 2" window get their blob URL revoked (see
  // the queue-change effect below), so this never grows unbounded across
  // a long listening session.
  const trackUrlCacheRef = useRef(new Map());
  // Bumped on every queue-change effect run so a slow lazy read that
  // resolves after the user has already skipped past it can't clobber
  // audio.src with a stale track's URL.
  const loadTokenRef = useRef(0);
  const accentCacheRef = useRef(new Map());
  // Always-current copy of `actions` (whose methods are recreated every
  // render) — MediaSession action handlers are registered once and need
  // to call into whatever "next"/"previous"/etc. currently do, not a
  // stale first-render closure.
  const actionsRef = useRef(null);
  // Listening-stats accounting: how many real seconds we've accumulated
  // for the currently-loaded track since the last flush to localStorage.
  const listenRef = useRef({ trackId: null, lastTime: 0, pendingSeconds: 0 });
  // Wall-clock time of the last MediaSession.setPositionState() call — see
  // POSITION_SYNC_INTERVAL_MS below for why this exists.
  const lastPositionSyncRef = useRef(0);
  // Always-current state.playing, read by the background-kill watchdog's
  // 'pause' listener (registered once on mount, so it can't close over a
  // fresh value the normal way).
  const playingRef = useRef(false);
  playingRef.current = state.playing;
  // Always-current queue position, read by the headset triple-click
  // detection in the media-session effect (registered once on mount, so it
  // can't close over a fresh value the normal way).
  const queueIndexRef = useRef(0);
  queueIndexRef.current = state.queueIndex;
  // When the last headset-driven skip-to-next happened, and where the
  // queue was sitting just before it — see the media-session effect.
  const headsetSkipAtRef = useRef(0);
  const headsetPreSkipIndexRef = useRef(null);
  // Always-current copy of state.library, read by pickNativeFolder (a
  // useCallback with an empty dep array, so it can't close over fresh state
  // the normal way) to carry reviewStatus decisions forward onto a fresh
  // rescan's track objects — otherwise every rescan would forget which
  // "possibly not music" tracks the user already confirmed or excluded.
  const libraryRef = useRef([]);
  libraryRef.current = state.library;
  // Guards the playlists-persist effect below against firing with the
  // still-default initialState.playlists before the launch effect has had
  // a chance to hydrate whatever was actually saved last session — without
  // this, that first render's default would overwrite the real save.
  const playlistsHydratedRef = useRef(false);
  // Same guard as playlistsHydratedRef, for the appearance-settings
  // persist effect below — without it that effect's first run would write
  // the still-default initialState theme/pack/font straight over whatever
  // the last session actually saved.
  const settingsHydratedRef = useRef(false);
  // Set by the audio-focus-change listener effect when it pauses playback
  // for a focus loss, so the matching AUDIOFOCUS_GAIN only resumes if
  // uPod itself did the pausing — never overriding a deliberate user
  // pause that happened to land while focus was also lost.
  const pausedByFocusLossRef = useRef(false);
  // A restored position (see RESTORE_PLAYBACK_STATE) waiting to be applied
  // to the real <audio> element once its metadata has actually loaded —
  // setting .currentTime any earlier is unreliable across browsers/WebViews.
  const pendingSeekRef = useRef(null);
  // When this app's own AudioFocus.requestFocus() last fired — see the
  // focus-change listener effect below (SELF_COLLISION_GUARD_MS) for why.
  const focusRequestedAtRef = useRef(0);

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

  // Resolves a track to a playable object URL — for browser/studio tracks
  // (which already carry a real File) this is just URL.createObjectURL;
  // for native tracks it's a lazy full-file Filesystem.readFile(), done
  // here for the first time (scanning never reads audio bytes). Results
  // are cached per track id and never reject — a failed native read
  // resolves to null so callers can show a toast instead of throwing.
  const getTrackObjectUrl = useCallback((track) => {
    const cache = trackUrlCacheRef.current;
    if (cache.has(track.id)) return cache.get(track.id);
    const promise = (
      track.file
        ? Promise.resolve(URL.createObjectURL(track.file))
        : readNativeTrackObjectUrl({ folderPath: track.folderPath, relativePath: track.relativePath })
    ).catch(() => null);
    cache.set(track.id, promise);
    return promise;
  }, []);

  function flushListen() {
    const l = listenRef.current;
    if (l.trackId && l.pendingSeconds > 0) {
      recordListen(l.trackId, l.pendingSeconds);
    }
    l.pendingSeconds = 0;
  }

  // Deliberately keyed on the current track's identity, NOT on
  // state.queue — appending to the queue (addToQueue) or splicing a track
  // in just after it (playNext) produces a new queue array reference
  // without changing which track is at queueIndex, and reassigning
  // audio.src (even to the same resolved URL) always restarts playback
  // from 0. Keying on the track itself means those queue-array-only
  // changes don't touch this effect at all. Prefetch/cleanup, which do
  // need to see every queue change, live in the effect below instead.
  const currentTrack = state.queue[state.queueIndex];
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Cut the previous track's audio synchronously, right here, before the
    // async getTrackObjectUrl() lookup below even starts — not after it
    // resolves. A prefetched track (skipping to the next queued one)
    // resolves near-instantly since its read already finished in the
    // background, but picking an arbitrary track elsewhere (Tracks tab, a
    // different album) hits a fresh native full-file read, and that native
    // bridge round trip is exactly the gap during which the OLD source was
    // previously left assigned and still playing on this same <audio>
    // element — audio.src only got overwritten once the NEW track's read
    // resolved. removeAttribute (not audio.src = "") + load() is the
    // standard no-network-error way to fully reset an HTMLMediaElement:
    // setting src to an empty string resolves against the current page URL
    // and fires a real error event, which would wrongly surface the
    // "file may be missing or unreadable" toast on every track change.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    // Flush whatever we'd accumulated for the previous track before
    // switching, then start a fresh accounting window for this one — plus
    // a 1-second "start" marker so every play attempt shows up in
    // lifetime/recently-played stats even if it's skipped almost
    // immediately.
    flushListen();
    listenRef.current = { trackId: currentTrack.id, lastTime: 0, pendingSeconds: 0 };
    if (state.playing) recordListen(currentTrack.id, 1);

    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    getTrackObjectUrl(currentTrack).then((url) => {
      if (token !== loadTokenRef.current) return; // superseded by a later track change
      if (!url) {
        dispatch({
          type: "SET_QUEUE_TOAST",
          message: `Couldn't play "${currentTrack.title}" — the file may be missing or unreadable.`,
        });
        return;
      }
      audio.src = url;
      audio.playbackRate = state.playbackRate;
      if (state.playing) {
        ensureEngine();
        audio.play().catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);

  // Prefetch/cleanup only — safe to re-run on every queue change (unlike
  // the effect above) since it never touches audio.src.
  useEffect(() => {
    const track = state.queue[state.queueIndex];
    if (!track) return;

    // Prefetch the next couple of tracks so a native track's lazy
    // full-file read (a native-bridge round trip) has already finished by
    // the time playback reaches it, similar in spirit to gapless preload.
    for (let ahead = 1; ahead <= 2; ahead++) {
      const upcoming = state.queue[state.queueIndex + ahead];
      if (upcoming) getTrackObjectUrl(upcoming);
    }

    // Bound memory: revoke blob URLs for anything outside the current
    // track + the two prefetched ahead of it.
    const keepIds = new Set(
      [track.id, state.queue[state.queueIndex + 1]?.id, state.queue[state.queueIndex + 2]?.id].filter(Boolean)
    );
    for (const [id, urlPromise] of trackUrlCacheRef.current) {
      if (!keepIds.has(id)) {
        urlPromise.then((url) => url && URL.revokeObjectURL(url));
        trackUrlCacheRef.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const isJump = !(delta > 0 && delta < 5);
      if (!isJump) l.pendingSeconds += delta;
      l.lastTime = now;
      if (l.pendingSeconds >= 10) flushListen();
      dispatch({ type: "TICK", currentTime: now });
      if (audio.duration) {
        // Powers the scrub bar on the lock screen/notification. Throttled
        // to POSITION_SYNC_INTERVAL_MS — see its definition for why — but a
        // seek/loop/track-change (the same jump detected above for listen
        // accounting) forces an immediate sync so the OS-level scrub bar
        // doesn't lag a user-initiated seek. Settled with .catch() since it
        // can reject on transient inconsistent values (e.g. position
        // momentarily exceeding duration mid-seek).
        const nowMs = performance.now();
        if (isJump || nowMs - lastPositionSyncRef.current >= POSITION_SYNC_INTERVAL_MS) {
          lastPositionSyncRef.current = nowMs;
          MediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          }).catch(() => {});
        }
      }
    };
    const onLoaded = () => {
      dispatch({ type: "SET_DURATION", duration: audio.duration || 0 });
      if (pendingSeekRef.current != null) {
        audio.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };
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
    // Headset multi-click. Worth being explicit about what is and isn't
    // ours here, because most of it is the platform's:
    //
    // Android itself handles single- and double-click on the headset
    // button. androidx's MediaSessionCompat.Callback.onMediaButtonEvent
    // returns false outright on SDK >= 27 ("Double tap of play/pause as
    // skipping to next already handled by framework"), and uPod targets
    // 36 — so a single click arrives here as play/pause and a double
    // click arrives as nexttrack, with no code of ours involved. That's
    // why single-click play/pause already worked.
    //
    // Triple-click is NOT provided, but it is inferable from what the
    // framework does deliver. The sequence for three clicks is: click 2
    // fires skip-to-next immediately, then click 3 starts a fresh
    // double-tap window and lands as play/pause once it expires. So a
    // play/pause arriving within TRIPLE_CLICK_WINDOW_MS of a skip we just
    // performed means the user actually clicked three times — we undo the
    // skip and step back from where the queue was before it.
    //
    // The cost of inferring rather than being told: deliberately
    // double-clicking to skip and then pressing play/pause again within
    // ~700ms is indistinguishable from a triple-click, and will be read as
    // one. That's a rare gesture pair, and the alternative (delaying every
    // single click by a detection window) would regress the one part of
    // this that already works well.
    const consumedAsTripleClick = () => {
      if (!headsetSkipAtRef.current) return false;
      if (Date.now() - headsetSkipAtRef.current > TRIPLE_CLICK_WINDOW_MS) return false;
      const preSkip = headsetPreSkipIndexRef.current;
      headsetSkipAtRef.current = 0;
      headsetPreSkipIndexRef.current = null;
      if (preSkip == null) return false;
      // "Previous" relative to the track the user was actually on when
      // they started clicking — not relative to the one the framework's
      // double-click already skipped us forward to.
      actionsRef.current.jumpToQueueIndex(Math.max(0, preSkip - 1));
      return true;
    };

    MediaSession.setActionHandler({ action: "play" }, () => {
      if (consumedAsTripleClick()) return;
      actionsRef.current.play();
    }).catch(() => {});
    MediaSession.setActionHandler({ action: "pause" }, () => {
      if (consumedAsTripleClick()) return;
      actionsRef.current.pause();
    }).catch(() => {});
    MediaSession.setActionHandler({ action: "previoustrack" }, () => actionsRef.current.previous()).catch(() => {});
    MediaSession.setActionHandler({ action: "nexttrack" }, () => {
      headsetSkipAtRef.current = Date.now();
      headsetPreSkipIndexRef.current = queueIndexRef.current;
      actionsRef.current.next();
    }).catch(() => {});
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

  // Headphone-unplug auto-pause — @capgo/capacitor-media-session doesn't
  // register for this (confirmed by reading its source) since it's
  // unrelated to MediaSession/hardware buttons; every well-behaved media
  // app is expected to listen for ACTION_AUDIO_BECOMING_NOISY itself. See
  // android/app/src/main/java/com/katiso/upod/NoisyAudioPlugin.java.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = NoisyAudio.addListener("noisy", () => actionsRef.current.pause());
    return () => {
      handle.then((h) => h.remove());
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

  // The only way a full filesystem scan happens: a manual tap, confirming
  // the first-run prompt, or the explicit "Rescan library" action in
  // Settings. Also counts as the user approving the current folder path,
  // so future launches can hydrate from cache without asking again.
  // Persists the freshly-scanned library to IndexedDB (best-effort — a
  // caching failure shouldn't surface as a scan failure) so the next
  // launch can skip scanning entirely.
  const pickNativeFolder = useCallback(async () => {
    dispatch({ type: "LOADING_LIBRARY" });
    markFolderConfirmedOnce();
    try {
      const { tracks, folderPath } = await scanNativeFolder((done, total) =>
        dispatch({ type: "LIBRARY_SCAN_PROGRESS", done, total })
      );
      // Carry forward any "possibly not music" review decision already
      // made for a track that's still there post-rescan (matched by id,
      // same as playlists/cover overrides/playback-state restoration do).
      const reviewDecisions = new Map(
        libraryRef.current.filter((t) => t.reviewStatus).map((t) => [t.id, t.reviewStatus])
      );
      const reviewedTracks = reviewDecisions.size
        ? tracks.map((t) => (reviewDecisions.has(t.id) ? { ...t, reviewStatus: reviewDecisions.get(t.id) } : t))
        : tracks;
      dispatch({ type: "LOAD_LIBRARY", tracks: reviewedTracks, folderName: folderPath });
      saveCachedLibrary({ tracks: reviewedTracks, folderPath }).catch((err) => {
        console.warn("Couldn't persist library cache:", err);
      });
    } catch (err) {
      dispatch({ type: "LIBRARY_ERROR", message: err.message || "Couldn't read your music folder." });
    }
  }, []);

  // Hydrates straight from the IndexedDB cache when there's one — no
  // filesystem scanning at all in that case. A real scan only happens if
  // there's no cache yet: either a first-ever run (surfaced via
  // pendingFolderConfirm, waiting for one explicit tap — see
  // WelcomeOnboarding.jsx) or a folder that was confirmed in a previous
  // session but somehow has no cached library (e.g. cache was cleared).
  // Assumes the caller has already confirmed storage permission is
  // granted — called both from the mount effect below and, on a fresh
  // install/reinstall where permission wasn't granted yet at mount time,
  // from WelcomeOnboarding once the user grants it and returns to the app.
  const initializeLibrary = useCallback(async () => {
    // Fire-and-forget — unrelated to library hydration/scanning below,
    // and a denial should just mean no notification, not a stalled
    // launch. See NotificationPermissionPlugin.java for why this exists.
    ensureNotificationPermission();

    // Load persisted cover overrides before anything else touches
    // state.library — both the cache-hydration and the scan paths below
    // dispatch LOAD_LIBRARY, which reapplies whatever's in
    // state.coverOverrides, so this must land first or a user's chosen
    // cover would flash the embedded one on this launch.
    const overrideRecords = await loadCoverOverrides();
    const overrides = {};
    for (const o of overrideRecords) {
      overrides[o.albumId] = coverObjectUrlFromBytes(o.coverBytes, o.coverFormat);
    }
    dispatch({ type: "SET_COVER_OVERRIDES", overrides });

    // Same idea for playlists (including Favourite Tunes) — they only
    // ever lived in React state before, so a full process kill (not just
    // backgrounding) wiped them. Must also land before the cache-hydration
    // early-return below, and playlistsHydratedRef must be set regardless
    // of which branch that takes, so the persist effect further down
    // knows it's safe to start saving instead of clobbering this with the
    // still-default initialState.playlists.
    const savedPlaylists = await loadCachedPlaylists();
    if (savedPlaylists && savedPlaylists.length > 0) {
      dispatch({ type: "SET_PLAYLISTS", playlists: savedPlaylists });
    }
    playlistsHydratedRef.current = true;

    const cached = await loadCachedLibrary();
    if (cached && cached.tracks.length > 0) {
      dispatch({ type: "LOAD_LIBRARY", tracks: cached.tracks, folderName: cached.folderPath });

      // Restore whatever queue/position the previous session left off
      // at — dispatched after LOAD_LIBRARY (not before) so the reducer
      // resolves trackIds against the now-current state.library. Only
      // meaningful when there's an actual cached library to resolve
      // against, so this is skipped on the fresh-scan paths below.
      const savedPlayback = await loadCachedPlaybackState();
      if (savedPlayback && savedPlayback.trackIds?.length > 0) {
        // Small positions aren't worth a seek — avoids a pointless
        // audio.currentTime write for a track that had barely started.
        pendingSeekRef.current = savedPlayback.position > 2 ? savedPlayback.position : null;
        dispatch({
          type: "RESTORE_PLAYBACK_STATE",
          trackIds: savedPlayback.trackIds,
          index: savedPlayback.index || 0,
          position: savedPlayback.position || 0,
        });
      }
      return;
    }

    const confirmed = await hasConfirmedFolderOnce();
    if (confirmed) {
      pickNativeFolder();
    } else {
      const path = await getMusicFolderPath();
      dispatch({ type: "SET_PENDING_FOLDER_CONFIRM", path });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickNativeFolder]);

  // Appearance settings (theme/button pack/font), restored on cold launch.
  // Deliberately its own mount effect rather than a step inside
  // initializeLibrary: that one runs only after ensureStoragePermission()
  // resolves true, so on a fresh install — where WelcomeOnboarding is what
  // the user is looking at — the saved theme would never be applied at
  // all. Appearance doesn't depend on storage access, so it shouldn't wait
  // on it.
  //
  // loadFont() is called here for the same reason setFontFamily calls it:
  // hydrating straight into state skips the action, and without it the
  // chosen Google Font's stylesheet is never requested, so the app would
  // render the saved font's CSS stack with nothing to resolve it to and
  // silently fall back to the default face.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      const saved = await loadCachedSettings();
      if (saved) {
        if (saved.fontFamily) loadFont(saved.fontFamily);
        dispatch({ type: "HYDRATE_SETTINGS", settings: saved });
      }
      // Set regardless of whether anything was saved — on a first-ever
      // launch there's no record yet, and the persist effect below still
      // needs to start saving from this point on.
      settingsHydratedRef.current = true;
    })();
  }, []);

  // Persists every appearance change. Gated on settingsHydratedRef so the
  // effect's initial run can't clobber the saved record with defaults
  // before the hydrate effect above has read it — the exact guard the
  // playlists persist effect uses, and for the exact same reason.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!settingsHydratedRef.current) return;
    persistSettings({
      theme: state.theme,
      buttonPack: state.buttonPack,
      fontFamily: state.fontFamily,
    }).catch((err) => {
      console.warn("Couldn't persist settings:", err);
    });
  }, [state.theme, state.buttonPack, state.fontFamily]);

  // On launch: request storage permission (needed for the lazy per-track
  // reads playback does later, regardless of cache state). If it's not
  // granted yet (fresh install/reinstall — see WelcomeOnboarding.jsx),
  // this deliberately does nothing further: the onboarding screen is
  // what's showing in that case, and it calls initializeLibrary itself
  // once the user grants access and returns to the app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      const granted = await ensureStoragePermission();
      if (!granted) return;
      await initializeLibrary();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persists every playlist mutation (add/remove/rename/create-from-effect/
  // save-queue-as-playlist, and toggling a Favourite) so a force-close from
  // the recent-apps switcher no longer wipes them. Gated on
  // playlistsHydratedRef so this can't fire with the still-default
  // initialState.playlists before the launch effect above has loaded
  // whatever was actually saved.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!playlistsHydratedRef.current) return;
    persistPlaylists(state.playlists).catch((err) => {
      console.warn("Couldn't persist playlists:", err);
    });
  }, [state.playlists]);

  // Background-kill detection (see backgroundPlaybackWatchdog.js) —
  // checks whether the previous session looks like it was killed by the
  // OS mid-playback, then arms the watchdog for this session.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    checkAndClearBackgroundKillMarker().then((killed) => {
      if (killed) dispatch({ type: "SET_BACKGROUND_KILL_NOTICE", value: true });
    });
    return armBackgroundWatchdog(playingRef);
  }, []);

  // Requests Android audio focus whenever playback starts, abandons it
  // when the user pauses — kept separate from the focus-change listener
  // effect below so each half of this can be reasoned about on its own.
  // Skips abandoning on a pause the listener effect itself triggered
  // (pausedByFocusLossRef) — for a transient loss we're still registered
  // and waiting for the eventual AUDIOFOCUS_GAIN; abandoning here would
  // drop that registration early.
  //
  // focusRequestedAtRef records when this fires — see the listener effect
  // below for why.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (state.playing) {
      focusRequestedAtRef.current = Date.now();
      AudioFocus.requestFocus().catch(() => {});
    } else if (!pausedByFocusLossRef.current) {
      AudioFocus.abandonFocus().catch(() => {});
    }
  }, [state.playing]);

  // Reacts to Android taking focus away (a call, another app's media, a
  // nav-prompt) or giving it back — see AudioFocusPlugin.java. Permanent
  // and transient loss both pause playback (simplest correct behavior;
  // Android doesn't require resuming after a *permanent* loss at all, and
  // treating transient the same avoids playing quietly under something
  // that expects to have the room, e.g. a voice assistant reply). Only a
  // duck (a brief, low-priority sound) lowers volume instead of pausing.
  //
  // SELF_COLLISION_GUARD_MS guards against a self-inflicted false "loss":
  // confirmed via logcat that on this WebView, playing an <audio> element
  // makes Chromium's own internal org.chromium.content.browser.
  // AudioFocusDelegate request native audio focus for itself too, ~2.5s
  // after playback starts — a SEPARATE request from this plugin's, from
  // the same uid/pid. Android doesn't know they're "the same" playback, so
  // Chromium's later request evicts ours and we get handed AUDIOFOCUS_LOSS
  // for our own track's own audio. Before this guard, that made every
  // single track pause itself a few seconds in, every time (see the commit
  // that added this guard for the full logcat trace) — the exact
  // "AudioFocus" comment above, written when this plugin was added,
  // assumed Chromium never requests focus on its own; that's no longer
  // true on this WebView build.
  // A REAL external interruption landing in that same ~2-3s window is
  // vanishingly unlikely, so ignoring an implausibly-early loss/lossTransient
  // is a safe trade — and if Chromium's own delegate ever does get handed a
  // *genuine* later loss (once it, not us, holds the real focus token), it
  // pauses the <audio> element itself, which the existing native "pause"
  // listener (see the timeupdate/loadedmetadata effect above) already syncs
  // into state.playing regardless of anything this listener does.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = AudioFocus.addListener("focuschange", ({ type }) => {
      const audio = audioRef.current;
      if (type === "loss" || type === "lossTransient") {
        const sinceRequest = Date.now() - focusRequestedAtRef.current;
        if (sinceRequest < SELF_COLLISION_GUARD_MS) return;
        if (playingRef.current) {
          pausedByFocusLossRef.current = true;
          actionsRef.current.pause();
        }
      } else if (type === "duck") {
        if (audio) audio.volume = 0.2;
      } else if (type === "gain") {
        if (audio) audio.volume = 1;
        if (pausedByFocusLossRef.current) {
          pausedByFocusLossRef.current = false;
          actionsRef.current.play();
        }
      }
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  // Holds a partial wake lock for as long as state.playing is true — see
  // PlaybackWakeLockPlugin.java for why. Acquiring is unconditional (not
  // gated on "am I already holding it") since re-acquiring an
  // already-held timed lock just refreshes its timeout.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (state.playing) {
      PlaybackWakeLock.acquire().catch(() => {});
    } else {
      PlaybackWakeLock.release().catch(() => {});
    }
  }, [state.playing]);

  // Refreshes the same wake lock's timeout on every track change too —
  // otherwise one continuous playback session longer than the lock's
  // safety timeout (see PlaybackWakeLockPlugin.java) would let the CPU
  // suspend mid-track even though playback never actually paused.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !state.playing) return;
    PlaybackWakeLock.acquire().catch(() => {});
  }, [currentTrack, state.playing]);

  // Periodic + event-driven playback-state persistence — same shape as
  // Auxio's own approach (event-driven saves on meaningful changes, plus
  // a periodic backup while actively playing) rather than saving on every
  // single timeupdate tick, which would hammer IndexedDB for no benefit.
  // Saves immediately on any queue/track/play-state change (covers "save
  // on pause" for free, since state.playing flipping false is itself a
  // change), then every 20s while playing to bound how much position
  // accuracy a mid-track kill could lose.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (state.queue.length === 0) return;
    const save = () => {
      persistPlaybackState({
        trackIds: state.queue.map((t) => t.id),
        index: state.queueIndex,
        position: audioRef.current?.currentTime || 0,
      }).catch(() => {});
    };
    save();
    if (!state.playing) return;
    const interval = setInterval(save, 20000);
    return () => clearInterval(interval);
  }, [state.queue, state.queueIndex, state.playing]);

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

  // Tapping a track in the Tracks list (or in search results) builds a
  // fresh random mix rather than queueing the visible list sequentially
  // from that point: the tapped track first, then up to
  // RANDOM_QUEUE_SIZE - 1 more drawn at random from the same pool that was
  // on screen (the full Tracks list, or the current search results while
  // searching). A pool smaller than RANDOM_QUEUE_SIZE just contributes all
  // of itself, shuffled.
  //
  // The tapped track is placed at index 0 rather than left wherever the
  // shuffle put it, so it's always what actually starts playing — that's
  // the one thing about the tap the user is unambiguously asking for.
  //
  // "The queue resets" on every such tap falls out of SET_QUEUE replacing
  // the queue wholesale: a second tap anywhere in the list or in search
  // results discards the previous random mix and draws a new one. Next/
  // Previous (SET_INDEX) and the queue modal's own reorder never route
  // through here, so neither disturbs the current mix.
  const playRandomMixFrom = useCallback((pool, track) => {
    if (!pool || pool.length === 0 || !track) return;
    const rest = shuffleArray(pool.filter((t) => t.id !== track.id)).slice(0, RANDOM_QUEUE_SIZE - 1);
    dispatch({ type: "SET_QUEUE", queue: [track, ...rest], index: 0 });
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
    // Called by WelcomeOnboarding once the user grants storage access and
    // returns to the app — kicks off the exact same hydrate-or-scan flow
    // the mount effect runs, which never got to on a fresh install/
    // reinstall where permission wasn't granted yet at mount time.
    initializeLibrary,
    playAlbumFromTrack,
    playPlaylist,
    playTrackList,
    playTrackListFrom,
    playRandomMixFrom,
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
    // Permanent delete from device storage — native tracks only (there's
    // no real on-device file to delete for a browser-picked or
    // Studio-rendered track). Returns { ok, error } so the caller (a
    // confirmation modal) can show a real failure instead of assuming
    // success. Order matters: pause first so we're not deleting a file
    // the audio element is actively decoding, then only touch any app
    // state (in-memory or persisted) once the disk delete has actually
    // succeeded.
    deleteTrack: async (track) => {
      const isCurrent = state.queue[state.queueIndex]?.id === track.id;
      if (isCurrent && audioRef.current) {
        audioRef.current.pause();
      }
      try {
        await deleteNativeTrack({ folderPath: track.folderPath, relativePath: track.relativePath });
      } catch (err) {
        return {
          ok: false,
          error: err?.message || "The file may already be gone, or permission was denied.",
        };
      }
      dispatch({ type: "DELETE_TRACK", trackId: track.id });
      // Re-persist the library cache so the deleted track doesn't
      // reappear on next launch without a rescan — playlists persist on
      // their own via the effect that watches state.playlists.
      const remainingTracks = state.library.filter((t) => t.id !== track.id);
      saveCachedLibrary({ tracks: remainingTracks, folderPath: state.selectedFolderName }).catch((err) => {
        console.warn("Couldn't persist library after delete:", err);
      });
      return { ok: true };
    },
    // decision: "confirmed" (treat as a normal library track from now on),
    // "excluded" (hide it, same as a hard-filtered voice note — reversible,
    // unlike deleteTrack), or null (undo, back to the review list).
    reviewTrack: (trackId, decision) => {
      dispatch({ type: "REVIEW_TRACK", trackId, decision });
      const tracks = state.library.map((t) => (t.id === trackId ? { ...t, reviewStatus: decision } : t));
      saveCachedLibrary({ tracks, folderPath: state.selectedFolderName }).catch((err) => {
        console.warn("Couldn't persist review decision:", err);
      });
    },
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
    // In-app only — does not write back to the file's embedded ID3
    // picture. `bytes`/`format` are the picked image's raw data, used to
    // persist the override (downscaled the same way embedded thumbnails
    // are) so it survives a rescan or app restart; the object URL is
    // created immediately from the same bytes so the UI updates without
    // waiting on the IndexedDB write.
    setAlbumCoverOverride: (albumId, bytes, format) => {
      const cover = coverObjectUrlFromBytes(bytes, format);
      dispatch({ type: "SET_ALBUM_COVER_OVERRIDE", albumId, cover });
      persistCoverOverride(albumId, bytes, format).catch((err) => {
        console.warn("Couldn't persist cover override:", err);
      });
    },
    // "Reset to original" — drops the override so the album falls back to
    // whatever's embedded in the files' own tags.
    clearAlbumCoverOverride: (albumId) => {
      dispatch({ type: "CLEAR_ALBUM_COVER_OVERRIDE", albumId });
      removePersistedCoverOverride(albumId).catch((err) => {
        console.warn("Couldn't clear persisted cover override:", err);
      });
    },
    // Same picker/persistence flow as setAlbumCoverOverride, keyed by
    // playlistCoverKey(playlistId) instead of an album id so the two can
    // share one IndexedDB store without colliding.
    setPlaylistCoverOverride: (playlistId, bytes, format) => {
      const cover = coverObjectUrlFromBytes(bytes, format);
      dispatch({ type: "SET_PLAYLIST_COVER_OVERRIDE", playlistId, cover });
      persistCoverOverride(playlistCoverKey(playlistId), bytes, format).catch((err) => {
        console.warn("Couldn't persist playlist cover override:", err);
      });
    },
    // "Remove custom cover" — playlists have no embedded original to fall
    // back to, so this just drops the override (default placeholder shows
    // instead), unlike clearAlbumCoverOverride's "reset to original".
    clearPlaylistCoverOverride: (playlistId) => {
      dispatch({ type: "CLEAR_PLAYLIST_COVER_OVERRIDE", playlistId });
      removePersistedCoverOverride(playlistCoverKey(playlistId)).catch((err) => {
        console.warn("Couldn't clear persisted playlist cover override:", err);
      });
    },
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
    dismissBackgroundKillNotice: () => dispatch({ type: "SET_BACKGROUND_KILL_NOTICE", value: false }),
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
    state.coverOverrides, state.backgroundKillNotice,
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

