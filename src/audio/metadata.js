// src/audio/metadata.js
// Parses MP3/FLAC/M4A/OGG metadata from File objects and groups tracks into albums.
import jsmediatags from "jsmediatags";

export const SUPPORTED_EXTENSIONS = ["mp3", "flac", "m4a", "ogg"];

export function isAudioFile(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
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

function coverArtObjectUrl(picture) {
  if (!picture) return null;
  try {
    const { data, format } = picture;
    const blob = new Blob([new Uint8Array(data)], { type: format });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function normalizeKey(str) {
  return (str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function parseTrackFile(file) {
  const tags = await readTagsFromFile(file);
  const title = tags.title || file.name.replace(/\.[^/.]+$/, "");
  const artist = (tags.artist || "Unknown Artist").trim();
  const hasAlbumTag = Boolean(tags.album && tags.album.trim());
  const album = (tags.album || "Unknown Album").trim();
  const albumArtist = (tags.TPE2?.data || tags.albumArtist || artist || "Unknown Artist").trim();
  const track = tags.track ? parseInt(String(tags.track).split("/")[0], 10) : 0;
  const year = tags.year || null;
  const genre = (tags.genre || "").trim() || null;
  const cover = coverArtObjectUrl(tags.picture);

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    title,
    artist,
    albumArtist,
    album,
    albumKey: normalizeKey(album),
    hasAlbumTag,
    track: Number.isFinite(track) ? track : 0,
    year,
    genre,
    addedAt: file.lastModified || Date.now(),
    cover,
  };
}

export async function parseLibrary(fileList) {
  const files = Array.from(fileList).filter((f) => isAudioFile(f.name));

  const voiceNotePattern = /(^|[\\/])(PTT-|AUD-.*-WA|voice[- _]?message|voicemail)/i;
  const musicFiles = files.filter((f) => !voiceNotePattern.test(f.name));

  const tracks = [];
  for (const file of musicFiles) {
    tracks.push(await parseTrackFile(file));
  }
  return tracks;
}

export function groupIntoAlbums(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = t.hasAlbumTag ? (t.albumKey || normalizeKey(t.album)) : `single::${t.id}`;
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
