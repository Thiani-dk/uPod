// src/audio/metadata.js
// Parses MP3/FLAC/M4A/OGG metadata — either from browser File objects (web
// folder picker) or, on native, from a {relativePath, folderPath, size}
// descriptor read via partial native reads (see nativeTagReader.js) — and
// groups the resulting tracks into albums.
import jsmediatags from "jsmediatags";
import { readNativeTags } from "./nativeTagReader";

export const SUPPORTED_EXTENSIONS = ["mp3", "flac", "m4a", "ogg"];

// Filename conventions confirmed against real recorder/call-recorder output
// (WhatsApp's PTT-/AUD-*-WA; Samsung's "Call recording_<timestamp>.m4a";
// OnePlus/Oppo's Sound Recorder, whose "Standard/Call/Interview/Meeting
// recording <n>.mp3" defaults were found live on a real device's
// Music/Recordings tree; and the generic "Recording"/"REC_" prefixes common
// across third-party voice-recorder apps) — not guessed. Deliberately
// anchored to the *start* of the filename (or a path segment), and
// deliberately does NOT include a bare "voice" substring: a real track in
// the wild ("Voice Of Kenya (outro).mp3") would otherwise be misfiltered.
const VOICE_NOTE_PATTERN =
  /(^|[\\/])(PTT-|AUD-.*-WA|voice[- _]?message|voice[- _]?note|voicemail|call[- _]?record|(standard|interview|meeting)[- _]?recording|recording|rec[-_])/i;

// Soft signal only (see possiblyNotMusic below) — a voice note/call
// recording rarely runs past a minute, while even a short musical
// interlude/skit track almost always still carries at least partial tags.
const LIKELY_SHORT_RECORDING_MAX_BYTES = 700 * 1024;

export function isAudioFile(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export function isVoiceNote(filename) {
  return VOICE_NOTE_PATTERN.test(filename);
}

// True audio duration isn't available here — computing it would mean
// decoding the file, which is exactly the full-payload read the native scan
// path (nativeFolder.js) is built to avoid. File size is a reasonable proxy
// instead: it's already known for free from the readdir() entry, and voice
// notes/call recordings are near-universally encoded at bitrates far below
// music (mono, 16-96kbps vs. music's typical 128-320kbps stereo), so a
// small file is a fair "probably short" stand-in for an actual duration
// check.
function isLikelyShortRecording(sizeBytes) {
  return typeof sizeBytes === "number" && sizeBytes > 0 && sizeBytes < LIKELY_SHORT_RECORDING_MAX_BYTES;
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
function buildTrackFromTags(tags, { id, name, addedAt, sizeBytes, extra }) {
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

  // Soft "review, don't auto-hide" signal — see isLikelyShortRecording and
  // the module comment above VOICE_NOTE_PATTERN. Real downloaded music
  // almost always carries at least a partial tag (a title, an artist —
  // something); a small file with none of title/artist/album tagged at all
  // is unusual for music but exactly what an unedited voice note looks
  // like. Never combined with isVoiceNote's hard filename match — those are
  // already dropped before a track object is even built.
  const hasAnyTag = Boolean((tags.title && tags.title.trim()) || (tags.artist && tags.artist.trim()) || hasAlbumTag);
  const possiblyNotMusic = !hasAnyTag && isLikelyShortRecording(sizeBytes);

  // Stricter than hasAnyTag above, and for a different job. hasAnyTag asks
  // "is this plausibly music at all"; this asks "does this file say enough
  // about itself to stand on its own in a flat list of every track you
  // own". A title with no artist doesn't — you can't tell what it is next
  // to 700 siblings — so this deliberately requires both. See
  // METADATA_ORIGIN and the general-pool rule that consumes it.
  const hasRealTags = Boolean(tags.title && tags.title.trim() && tags.artist && tags.artist.trim());

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
    possiblyNotMusic,
    hasRealTags,
    ...extra,
  };
}

export async function parseTrackFile(file) {
  const tags = await readTagsFromFile(file);
  return buildTrackFromTags(tags, {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    addedAt: file.lastModified || Date.now(),
    sizeBytes: file.size,
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
    sizeBytes: size,
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

// Where a track's metadata actually came from, and therefore how much
// weight it carries. Introduced for the metadata cleaner; see
// PLAN-metadata-cleaner.md.
//
//   VERIFIED  matched against MusicBrainz and confirmed by the user.
//   DECLARED  the user stated it outright, with nothing to check it
//             against. Authoritative for *display* — if they took the
//             trouble to type it, that's what they want to see — but
//             deliberately not treated as identification, because nothing
//             corroborates it.
//   EMBEDDED  the file's own tags, and they're substantial enough to
//             identify the track (see hasRealTags).
//   UNKNOWN   nothing usable: no verified match, nothing declared, and
//             tags too thin to identify it.
//
// TRUSTED is a fifth, deliberately grandfathered state — see
// loadTrustBaseline in libraryCache.js. Tracks that were already in the
// library before any of this shipped keep their existing behaviour
// untouched rather than being retroactively demoted, which would be a
// disruptive regression to a library already in daily use.
export const METADATA_ORIGIN = {
  VERIFIED: "verified",
  DECLARED: "declared",
  EMBEDDED: "embedded",
  TRUSTED: "trusted",
  UNKNOWN: "unknown",
};

// Resolves a track's origin from the three inputs that can establish it,
// in precedence order: an explicit record the cleaner wrote, then the
// grandfathering baseline, then the file's own tags.
export function resolveMetadataOrigin(track, declaredRecord, trustBaseline) {
  if (declaredRecord?.origin === METADATA_ORIGIN.VERIFIED) return METADATA_ORIGIN.VERIFIED;
  if (declaredRecord?.origin === METADATA_ORIGIN.DECLARED) return METADATA_ORIGIN.DECLARED;
  if (trustBaseline?.has(track.id)) return METADATA_ORIGIN.TRUSTED;
  return track.hasRealTags ? METADATA_ORIGIN.EMBEDDED : METADATA_ORIGIN.UNKNOWN;
}

// Applies a stored metadata record (verified match or user declaration)
// over a freshly-scanned or cache-hydrated track, and stamps the resolved
// origin. Returns the track untouched apart from `metadataOrigin` when
// there's no record, so this is safe to run across the whole library.
export function applyStoredMetadata(track, declaredRecord, trustBaseline) {
  const metadataOrigin = resolveMetadataOrigin(track, declaredRecord, trustBaseline);

  // What the file itself said, snapshotted the first time anything
  // overrides it. Two paths (deleteTrack, reviewTrack) re-persist
  // state.library — the *merged* view — back into the library cache, so
  // overridden values can end up baked into a track record. Without a
  // snapshot, clearing a record later would leave those baked values in
  // place and "revert" wouldn't actually revert until the next full
  // rescan. Keeping the original makes applying idempotent and undoing
  // exact, whatever happens to be in the cache.
  const original = track.metadataOriginal || {
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
    hasAlbumTag: track.hasAlbumTag,
    track: track.track,
    trackConfirmed: track.trackConfirmed,
  };

  if (!declaredRecord?.fields) {
    // No record: restore the file's own values and drop the snapshot, so
    // the track goes back to being plain file-derived data.
    const { metadataOriginal: _drop, ...rest } = track;
    return {
      ...rest,
      ...original,
      albumKey: normalizeKey(original.album),
      metadataOrigin,
      metadataSource: null,
    };
  }

  const f = declaredRecord.fields;
  const album = f.album || original.album;
  return {
    ...track,
    metadataOriginal: original,
    title: f.title || original.title,
    artist: f.artist || original.artist,
    album,
    albumKey: normalizeKey(album),
    hasAlbumTag: f.album ? true : original.hasAlbumTag,
    year: f.year || original.year,
    // A track number the user set by hand is as confirmed as one the
    // track-order fixer wrote, so it suppresses the "unconfirmed order"
    // treatment the same way.
    ...(f.track !== undefined && f.track !== null
      ? { track: f.track, trackConfirmed: true }
      : {}),
    metadataOrigin,
    metadataSource: declaredRecord.source || null,
  };
}

// A track flagged possiblyNotMusic stays out of albums/library views (and
// off the "single::<id>" singles list too) until the user has actually
// looked at it in the "Possibly not music" review list and either
// confirmed it as real music or excluded it — see reviewStatus. It's never
// silently dropped for good on its own; state.library (the full scanned
// set, unfiltered) is what that review screen reads from.
export function isTrackVisible(t) {
  if (t.reviewStatus === "excluded") return false;
  if (t.possiblyNotMusic && t.reviewStatus !== "confirmed") return false;
  return true;
}

export function groupIntoAlbums(tracks) {
  const map = new Map();
  for (const t of tracks.filter(isTrackVisible)) {
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
