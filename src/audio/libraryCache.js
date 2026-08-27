// src/audio/libraryCache.js
// Persists the parsed native library (metadata + a downscaled cover
// thumbnail per track — never audio bytes) to IndexedDB, so the app can
// hydrate straight from cache on launch instead of rescanning the whole
// music folder every time. IndexedDB is used rather than
// @capacitor/preferences because this is hundreds of structured records,
// not a handful of simple key/value settings.
import { coverObjectUrlFromBytes } from "./metadata";

const DB_NAME = "upod-library";
const DB_VERSION = 2;
const TRACKS_STORE = "tracks";
const META_STORE = "meta";
// User-chosen cover art, keyed by album id (same identity groupIntoAlbums
// uses — see albumIdForTrack in metadata.js). Deliberately a separate
// store from `tracks`: it holds an explicit override the user chose, not
// derived/embedded data, so it must survive a rescan even though `tracks`
// gets wiped and rebuilt on every one.
const COVER_OVERRIDES_STORE = "coverOverrides";

// Cover thumbnails are capped at this size purely to bound IndexedDB
// storage for large libraries — some embedded covers are several thousand
// pixels square, far more resolution than the UI (album art, now-playing,
// lock-screen artwork) ever renders at.
const COVER_MAX_DIMENSION = 480;
const COVER_QUALITY = 0.82;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACKS_STORE)) db.createObjectStore(TRACKS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(COVER_OVERRIDES_STORE)) {
        db.createObjectStore(COVER_OVERRIDES_STORE, { keyPath: "albumId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Downscales+re-encodes cover art as JPEG via canvas. Falls back to the
// original bytes untouched if the image is already small, or if any step
// fails (e.g. an unsupported embedded format) — a persistence-layer
// optimization failing shouldn't block caching the track at all.
async function shrinkCoverBytes(bytes, format) {
  try {
    const blob = new Blob([bytes], { type: format || "image/jpeg" });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, COVER_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return { bytes, format: format || "image/jpeg" };
    }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const outBlob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: "image/jpeg", quality: COVER_QUALITY })
      : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", COVER_QUALITY));
    const buf = await outBlob.arrayBuffer();
    return { bytes: new Uint8Array(buf), format: "image/jpeg" };
  } catch {
    return { bytes, format: format || "image/jpeg" };
  }
}

// Persists `tracks` (as produced by scanNativeFolder + parseNativeTrackDescriptor)
// plus which folder they came from. Replaces whatever was cached before —
// callers pass the complete, current library each time (a rescan's result
// or the same set re-saved), never an incremental diff.
// How many cover thumbnails to shrink concurrently. A library made up
// mostly of individually-downloaded singles (as opposed to ripped albums)
// can have a near-unique cover per track, defeating the per-album dedup
// below — for ~700 such tracks, encoding them one at a time serially took
// several minutes on-device. createImageBitmap's decode work runs off the
// JS main thread, so overlapping several at once genuinely parallelizes
// rather than just interleaving.
const SHRINK_CONCURRENCY = 6;

async function buildRecord(t, shrinkCache) {
  let coverBytes = null;
  let coverFormat = null;
  if (t.coverBytes && t.coverBytes.length) {
    // Tracks in the same album almost always share identical embedded
    // cover art — dedupe the (relatively expensive) canvas re-encode by
    // album instead of doing it once per track.
    const key = `${t.albumKey || t.album}:${t.coverBytes.length}`;
    if (!shrinkCache.has(key)) shrinkCache.set(key, shrinkCoverBytes(t.coverBytes, t.coverFormat));
    const shrunk = await shrinkCache.get(key);
    coverBytes = shrunk.bytes;
    coverFormat = shrunk.format;
  }
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    albumArtist: t.albumArtist,
    album: t.album,
    albumKey: t.albumKey,
    hasAlbumTag: t.hasAlbumTag,
    track: t.track,
    trackConfirmed: t.trackConfirmed === undefined ? null : t.trackConfirmed,
    year: t.year,
    genre: t.genre,
    addedAt: t.addedAt,
    relativePath: t.relativePath,
    folderPath: t.folderPath,
    size: t.size,
    coverBytes,
    coverFormat,
  };
}

export async function saveLibrary({ tracks, folderPath }) {
  const shrinkCache = new Map();
  const records = new Array(tracks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tracks.length) {
      const i = nextIndex++;
      records[i] = await buildRecord(tracks[i], shrinkCache);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SHRINK_CONCURRENCY, tracks.length) }, () => worker())
  );

  const db = await openDb();
  try {
    const tx = db.transaction([TRACKS_STORE, META_STORE], "readwrite");
    tx.objectStore(TRACKS_STORE).clear();
    for (const r of records) tx.objectStore(TRACKS_STORE).put(r);
    tx.objectStore(META_STORE).put({ key: "info", folderPath, scannedAt: Date.now(), trackCount: records.length });
    await txDone(tx);
  } finally {
    db.close();
  }
}

// Returns { tracks, folderPath } hydrated from cache, or null if nothing's
// cached yet (first-ever launch, or the cache was cleared). Never throws —
// any failure here should fall back to a real scan, not crash startup.
export async function loadLibrary() {
  if (typeof indexedDB === "undefined") return null;
  let db;
  try {
    db = await openDb();
    const info = await promisifyRequest(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get("info"));
    if (!info) return null;

    const records = await promisifyRequest(db.transaction(TRACKS_STORE, "readonly").objectStore(TRACKS_STORE).getAll());
    if (!records || records.length === 0) return null;

    const tracks = records.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      albumArtist: r.albumArtist,
      album: r.album,
      albumKey: r.albumKey,
      hasAlbumTag: r.hasAlbumTag,
      track: r.track,
      trackConfirmed: r.trackConfirmed === null ? undefined : r.trackConfirmed,
      year: r.year,
      genre: r.genre,
      addedAt: r.addedAt,
      relativePath: r.relativePath,
      folderPath: r.folderPath,
      size: r.size,
      native: true,
      cover: coverObjectUrlFromBytes(r.coverBytes, r.coverFormat),
      coverBytes: r.coverBytes,
      coverFormat: r.coverFormat,
    }));

    return { tracks, folderPath: info.folderPath };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function clearLibrary() {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    const tx = db.transaction([TRACKS_STORE, META_STORE], "readwrite");
    tx.objectStore(TRACKS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}

// Persists a user-chosen cover for `albumId`, downscaled the same way
// embedded thumbnails are (shrinkCoverBytes) for storage consistency.
// Lives in its own store from `tracks` specifically so a rescan (which
// clears and rebuilds `tracks` every time) never touches it.
export async function saveCoverOverride(albumId, bytes, format) {
  const shrunk = await shrinkCoverBytes(bytes, format);
  const db = await openDb();
  try {
    const tx = db.transaction(COVER_OVERRIDES_STORE, "readwrite");
    tx.objectStore(COVER_OVERRIDES_STORE).put({
      albumId,
      coverBytes: shrunk.bytes,
      coverFormat: shrunk.format,
      updatedAt: Date.now(),
    });
    await txDone(tx);
  } finally {
    db.close();
  }
}

// Removes a user override, letting that album fall back to its embedded
// cover art again ("reset to original").
export async function clearCoverOverride(albumId) {
  const db = await openDb();
  try {
    const tx = db.transaction(COVER_OVERRIDES_STORE, "readwrite");
    tx.objectStore(COVER_OVERRIDES_STORE).delete(albumId);
    await txDone(tx);
  } finally {
    db.close();
  }
}

// Returns every persisted override as [{ albumId, coverBytes, coverFormat }, ...].
// Never throws — a failure here should just mean "no overrides this launch",
// not block startup.
export async function loadCoverOverrides() {
  if (typeof indexedDB === "undefined") return [];
  let db;
  try {
    db = await openDb();
    const records = await promisifyRequest(
      db.transaction(COVER_OVERRIDES_STORE, "readonly").objectStore(COVER_OVERRIDES_STORE).getAll()
    );
    return records || [];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
