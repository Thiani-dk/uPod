// src/utils/listeningStats.js
// Real listening history — persisted in localStorage, keyed by the same
// stable track id used everywhere else (filename+size+lastModified), so
// stats survive re-picking the same folder across sessions.
//
// Model: an append-only event log, capped in length. Each event is one
// "listen" of a track for N seconds. Everything (lifetime plays, monthly
// plays, monthly/total time, most-played, recently-played) is derived by
// filtering/aggregating this log — no separate running totals to keep in
// sync, one source of truth.

const STORAGE_KEY = "upod-listening-log";
const MAX_EVENTS = 4000;

function loadLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLog(log) {
  try {
    // Cap the log so localStorage never grows unbounded — drop oldest first.
    const trimmed = log.length > MAX_EVENTS ? log.slice(log.length - MAX_EVENTS) : log;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full — non-fatal, stats just stop growing */
  }
}

// Records that `trackId` was listened to for `seconds` seconds, right now.
export function recordListen(trackId, seconds) {
  if (!trackId || !seconds || seconds <= 0) return;
  const log = loadLog();
  log.push({ trackId, ts: Date.now(), seconds: Math.round(seconds) });
  saveLog(log);
}

function isThisMonth(ts) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Computes every stat the Play Now tab needs from the raw event log plus
 * the current library/albums/playlists — nothing here is stored
 * separately, it's all derived fresh each call (cheap: a few thousand
 * events max, tens/hundreds of tracks).
 */
export function computeLibraryStats(library, albums, playlists) {
  const log = loadLog();

  const byTrack = new Map(); // trackId -> { count, totalSeconds, lastPlayedAt, monthSeconds, monthCount }
  for (const ev of log) {
    let entry = byTrack.get(ev.trackId);
    if (!entry) {
      entry = { count: 0, totalSeconds: 0, lastPlayedAt: 0, monthSeconds: 0, monthCount: 0 };
      byTrack.set(ev.trackId, entry);
    }
    entry.count += 1;
    entry.totalSeconds += ev.seconds;
    entry.lastPlayedAt = Math.max(entry.lastPlayedAt, ev.ts);
    if (isThisMonth(ev.ts)) {
      entry.monthSeconds += ev.seconds;
      entry.monthCount += 1;
    }
  }

  const trackById = new Map(library.map((t) => [t.id, t]));

  const lifetimeTracksPlayed = byTrack.size;
  const tracksPlayedThisMonth = [...byTrack.values()].filter((e) => e.monthCount > 0).length;
  const timePlayedThisMonthSec = [...byTrack.values()].reduce((sum, e) => sum + e.monthSeconds, 0);
  const totalTimePlayedSec = [...byTrack.values()].reduce((sum, e) => sum + e.totalSeconds, 0);

  const artistSet = new Set(library.map((t) => t.artist));
  const genreSet = new Set(library.map((t) => t.genre).filter(Boolean));

  // Tracks that came out of a Studio effect render (slowed+reverb, etc).
  // ADD_RENDERED_TRACK stamps isStudioRender:true on each one before it
  // lands in the library, and also files it into that effect's playlist —
  // counting the flag directly is the single source of truth either way.
  const modifiedCount = library.filter((t) => t.isStudioRender).length;

  const neverPlayed = library.filter((t) => !byTrack.has(t.id));

  const mostPlayedThisMonth = [...byTrack.entries()]
    .filter(([, e]) => e.monthCount > 0)
    .sort((a, b) => b[1].monthSeconds - a[1].monthSeconds)
    .map(([id]) => trackById.get(id))
    .filter(Boolean)
    .slice(0, 12);

  const recentlyPlayed = [...byTrack.entries()]
    .sort((a, b) => b[1].lastPlayedAt - a[1].lastPlayedAt)
    .map(([id]) => trackById.get(id))
    .filter(Boolean)
    .slice(0, 12);

  const recentlyAdded = [...library].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 12);

  const popularAlbums = [...albums]
    .map((al) => ({
      album: al,
      plays: al.tracks.reduce((sum, t) => sum + (byTrack.get(t.id)?.count || 0), 0),
    }))
    .filter((a) => a.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .map((a) => a.album)
    .slice(0, 12);

  const favoritesPlaylist = playlists.find((p) => p.id === "pl-favorites");
  const favoriteTracks = favoritesPlaylist
    ? favoritesPlaylist.trackIds.map((id) => trackById.get(id)).filter(Boolean)
    : [];

  return {
    totals: {
      tracks: library.length,
      artists: artistSet.size,
      albums: albums.length,
      genres: genreSet.size,
      neverPlayedCount: neverPlayed.length,
      modifiedCount,
    },
    lifetimeTracksPlayed,
    tracksPlayedThisMonth,
    timePlayedThisMonth: formatDuration(timePlayedThisMonthSec),
    totalTimePlayed: formatDuration(totalTimePlayedSec),
    neverPlayed,
    mostPlayedThisMonth,
    recentlyPlayed,
    recentlyAdded,
    popularAlbums,
    favoriteTracks,
  };
}
