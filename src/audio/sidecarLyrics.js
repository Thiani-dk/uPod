// src/audio/sidecarLyrics.js
// Reads lyrics that are already sitting on the device next to the audio.
//
// This exists because a real library had them and the app was ignoring
// them: 122 .lrc files in the music folder, none of which uPod had ever
// looked at, because lyrics were only ever fetched from the network.
// They cost no request, work with no connection, and are the user's own
// files — so they are consulted before anything is downloaded.
//
// Two things about them are not what the extension suggests, and both
// were found by reading the actual files rather than assuming:
//
//   - None are time-synced. Despite the .lrc extension they are plain
//     text, so they feed the section-level highlight, not the per-line
//     one. The file is still read as LRC first in case a genuinely
//     timestamped one turns up.
//   - They are scraped from a lyrics site, so they arrive wrapped in that
//     site's furniture: a "202 Contributors Translations Русский …
//     <Title> Lyrics" header and a trailing "8 Embed". Both are stripped,
//     because rendering them as the first and last lines of a song is
//     worse than not finding the file at all.
//
// Matching is by normalised filename, never by exact name: not one of
// those 122 files matched its track exactly. They are named
// "<track>(MP3_320K)_private.lrc" against a "<track>.mp3", so the codec
// tag, the bitrate and the trailing _private all have to come off before
// the two names resemble each other — after which 59 of them pair up.
import { Filesystem, Directory } from "@capacitor/filesystem";

const LYRICS_EXTENSIONS = [".lrc", ".txt"];

// Below this, two filenames are different songs. Deliberately strict:
// attaching the wrong lyrics to a track is worse than attaching none,
// and the whole point of a sidecar file is that it is unambiguous.
const NAME_MATCH_FLOOR = 0.9;

function stripDownloadNoise(name) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    // "(MP3_320K)", "(M4A_128K)", "( 128kbps )", "-192k"
    .replace(/\((?:mp3|m4a|opus|ogg|flac|wav)[_\s-]*\d{2,4}\s*k?\)/gi, " ")
    .replace(/\(\s*\d{2,4}\s*kbps\s*\)/gi, " ")
    .replace(/[-_]\s*\d{2,3}k\b/gi, " ")
    // yt-dlp/Videoder's own suffixes
    .replace(/_private\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeName(name) {
  return stripDownloadNoise(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Bigram overlap (Dice) — tolerant of a missing word or a punctuation
  // difference, intolerant of two genuinely different titles.
  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) if (B.has(g)) shared += Math.min(n, B.get(g));
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

// Strips the lyrics-site furniture described in the module comment.
export function cleanScrapedLyrics(raw) {
  let text = (raw || "").replace(/\r\n/g, "\n").trim();

  // Leading "<n> Contributors … <Song Title> Lyrics" preamble. Only cut
  // when the Contributors marker is actually there, so a legitimate song
  // whose first line happens to contain the word "Lyrics" is untouched.
  if (/^\s*\d+\s+Contributors?/i.test(text)) {
    const marker = text.search(/\bLyrics\b/i);
    if (marker !== -1 && marker < 600) text = text.slice(marker + "Lyrics".length);
  }

  // Trailing "8 Embed" / "Embed" counter.
  text = text.replace(/\s*\d*\s*Embed\s*$/i, "");
  // "You might also like" is injected mid-text by the same source.
  text = text.replace(/^\s*You might also like\s*$/gim, "");

  return text.trim();
}

function parentOf(relativePath) {
  const i = relativePath.lastIndexOf("/");
  return i === -1 ? "" : relativePath.slice(0, i);
}

function baseNameOf(relativePath) {
  const i = relativePath.lastIndexOf("/");
  return i === -1 ? relativePath : relativePath.slice(i + 1);
}

// Returns { lyrics, synced, fileName } for a track, or null. Never throws
// — a sidecar is a bonus, and a folder that can't be read just means
// falling through to the online lookup.
export async function readSidecarLyrics({ folderPath, relativePath }) {
  if (!folderPath || !relativePath) return null;
  try {
    const dir = parentOf(relativePath);
    const fullDir = dir ? `${folderPath}/${dir}` : folderPath;
    const { files } = await Filesystem.readdir({ path: fullDir, directory: Directory.ExternalStorage });

    const candidates = (files || []).filter(
      (f) => f.type !== "directory" && LYRICS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (candidates.length === 0) return null;

    const target = normalizeName(baseNameOf(relativePath));
    if (!target) return null;

    let best = null;
    let bestScore = 0;
    for (const file of candidates) {
      const score = similarity(target, normalizeName(file.name));
      if (score > bestScore) {
        bestScore = score;
        best = file;
      }
    }
    if (!best || bestScore < NAME_MATCH_FLOOR) return null;

    const read = await Filesystem.readFile({
      path: `${fullDir}/${best.name}`,
      directory: Directory.ExternalStorage,
      encoding: "utf8",
    });
    const raw = typeof read.data === "string" ? read.data : "";
    const hasTimestamps = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(raw);
    const lyrics = cleanScrapedLyrics(
      hasTimestamps ? raw.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim() : raw
    );
    if (!lyrics || lyrics.length < 20) return null;

    return { lyrics, synced: hasTimestamps ? raw : null, fileName: best.name };
  } catch {
    return null;
  }
}
