// src/audio/metadata.js
// Parses MP3/FLAC/M4A/OGG metadata — either from browser File objects (web
// folder picker) or, on native, from a {relativePath, folderPath, size}
// descriptor read via partial native reads (see nativeTagReader.js) — and
// groups the resulting tracks into albums.
import jsmediatags from "jsmediatags";
import { readNativeTags } from "./nativeTagReader";

export const SUPPORTED_EXTENSIONS = ["mp3", "flac", "m4a", "ogg"];

const VOICE_NOTE_PATTERN = /(^|[\\/])(PTT-|AUD-.*-WA|voice[- _]?message|voicemail)/i;

export function isAudioFile(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export function isVoiceNote(filename) {
  return VOICE_NOTE_PATTERN.test(filename);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function gradientForAlbum(albumName) {
  const h = hashString(albumName || "Unknown Album");
  const hue1 = h % 360;
  const hue2 = (hue1 + 55) % 360;
  return [`hsl(${hue1}, 70%, 55%)`, `hsl(${hue2}, 65%, 22%)`];
}

function readTagsFromFile(file) {
  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess: (tag) => resolve(tag.tags),
      onError: () => resolve({}),
    });
  });
}

// Raw bytes + mime type, kept separate from the object URL so callers that
// persist the library (libraryCache.js) can store the bytes themselves —
// URL.createObjectURL() results don't survive an app restart, but the
// underlying bytes stashed in IndexedDB do, and a fresh object URL can be
// regenerated from them cheaply on the next launch.
function extractCoverData(picture) {
  if (!picture || !picture.data || !picture.data.length) return null;
  try {
    return { bytes: new Uint8Array(picture.data), format: picture.format || "image/jpeg" };
  } catch {
    return null;
  }
}

export function coverObjectUrlFromBytes(bytes, format) {
  if (!bytes || !bytes.length) return null;
  try {
    const blob = new Blob([bytes], { type: format || "image/jpeg" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function normalizeKey(str) {
  return (str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// The same album-identity key groupIntoAlbums uses to bucket tracks —
// pulled out so cover-override persistence (keyed by album id) can match
// tracks to albums without duplicating this logic and risking drift.
export function albumIdForTrack(t) {
  return t.hasAlbumTag ? (t.albumKey || normalizeKey(t.album)) : `single::${t.id}`;
}

// Shared shape-building logic between the browser (File-backed) and native
// (descriptor-backed) parsing paths — everything after tags have been read
// is identical regardless of where the bytes came from.
function buildTrackFromTags(tags, { id, name, addedAt, extra }) {
  const title = tags.title || name.replace(/\.[^/.]+$/, "");
  const artist = (tags.artist || "Unknown Artist").trim();
  const hasAlbumTag = Boolean(tags.album && tags.album.trim());
  const album = (tags.album || "Unknown Album").trim();
  const albumArtist = (tags.TPE2?.data || tags.albumArtist || artist || "Unknown Artist").trim();
  const track = tags.track ? parseInt(String(tags.track).split("/")[0], 10) : 0;
  const year = tags.year || null;
  const genre = (tags.genre || "").trim() || null;
  const coverData = extractCoverData(tags.picture);
  const cover = coverData ? coverObjectUrlFromBytes(coverData.bytes, coverData.format) : null;

  return {
    id,
    title,
    artist,
    albumArtist,
    album,
    albumKey: normalizeKey(album),
    hasAlbumTag,
    track: Number.isFinite(track) ? track : 0,
    year,
    genre,
    addedAt,
    cover,
    coverBytes: coverData?.bytes || null,
    coverFormat: coverData?.format || null,
    ...extra,
  };
}

export async function parseTrackFile(file) {
  const tags = await readTagsFromFile(file);
  return buildTrackFromTags(tags, {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    addedAt: file.lastModified || Date.now(),
    extra: { file },
  });
}

// Native scan path: reads only the tag-relevant byte ranges (never the
// audio payload — see nativeTagReader.js) and produces a track with no
// `file`/bytes attached, just enough (`relativePath` + `folderPath`) for
// PlayerContext to lazily read the real audio bytes at play time.
export async function parseNativeTrackDescriptor({ name, relativePath, folderPath, directory, size, mtime }) {
  const tags = await readNativeTags({ path: `${folderPath}/${relativePath}`, directory, size });
  return buildTrackFromTags(tags, {
    id: `${relativePath}-${size}-${mtime || 0}`,
    name,
    addedAt: mtime || Date.now(),
    extra: { relativePath, folderPath, size, native: true },
  });
}

export async function parseLibrary(fileList) {
  const files = Array.from(fileList).filter((f) => isAudioFile(f.name));
  const musicFiles = files.filter((f) => !isVoiceNote(f.name));

  const tracks = [];
  for (const file of musicFiles) {
    tracks.push(await parseTrackFile(file));
  }
  return tracks;
}

export function groupIntoAlbums(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = albumIdForTrack(t);
    if (!map.has(key)) {
      const seed = t.hasAlbumTag ? t.album : `${t.title}::${t.artist}::${t.id}`;
      map.set(key, {
        id: key,
        title: t.hasAlbumTag ? t.album : t.title,
        forcedArtist: t.hasAlbumTag ? null : t.artist,
        artistCandidates: new Map(),
        year: t.year,
        cover: t.cover,
        gradient: gradientForAlbum(seed),
        tracks: [],
      });
    }
    const entry = map.get(key);
    entry.tracks.push(t);
    if (!entry.cover && t.cover) entry.cover = t.cover;
    if (!entry.year && t.year) entry.year = t.year;

    const artistKey = normalizeKey(t.albumArtist || t.artist);
    const existing = entry.artistCandidates.get(artistKey);
    entry.artistCandidates.set(artistKey, {
      display: existing?.display || (t.albumArtist || t.artist),
      count: (existing?.count || 0) + 1,
    });
  }

  const albums = Array.from(map.values()).map((entry) => {
    let artist = entry.forcedArtist;
    if (!artist) {
      const candidates = Array.from(entry.artistCandidates.values()).sort((a, b) => b.count - a.count);
      const top = candidates[0];
      const majority = top && top.count / entry.tracks.length >= 0.5;
      artist = majority ? top.display : candidates.length > 1 ? "Various Artists" : top?.display || "Unknown Artist";
    }

    const numberCounts = {};
    for (const t of entry.tracks) {
      if (t.track > 0) numberCounts[t.track] = (numberCounts[t.track] || 0) + 1;
    }
    const isReliable = (t) => {
      if (t.trackConfirmed === true) return true;
      if (t.trackConfirmed === false) return false;
      return t.track > 0 && numberCounts[t.track] === 1;
    };

    const sortedTracks = [...entry.tracks].sort((a, b) => {
      const aOk = isReliable(a);
      const bOk = isReliable(b);
      if (aOk && bOk) return a.track - b.track;
      if (aOk) return -1;
      if (bOk) return 1;
      return a.title.localeCompare(b.title);
    });

    return {
      id: entry.id,
      title: entry.title,
      artist,
      year: entry.year,
      cover: entry.cover,
      gradient: entry.gradient,
      tracks: sortedTracks,
    };
  });

  albums.sort((a, b) => a.title.localeCompare(b.title));
  return albums;
}
