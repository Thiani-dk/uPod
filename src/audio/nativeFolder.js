// src/audio/nativeFolder.js
// Reads a user-configurable folder from device shared storage via
// @capacitor/filesystem and turns its audio files into real File objects,
// so the result can be fed into the exact same parseLibrary() path as the
// browser folder picker.
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";

// Every music path is confined under this root — scanning stays limited
// to the Downloads folder tree, never the whole device.
export const MUSIC_FOLDER_ROOT = "Download";

// Used the first time the app runs, and whenever the stored path is reset.
export const DEFAULT_MUSIC_FOLDER = "Download/Music Downloads";

const STORAGE_KEY = "upod_music_folder_path";
const CONFIRMED_ONCE_KEY = "upod_folder_confirmed_once";

// Safety ceiling only — not a real limit on folder structure depth.
// Hidden/dot-prefixed folders (app caches, etc.) are skipped by name
// during the walk, which is what actually keeps the scan from wandering
// into huge unrelated folders; this just stops runaway recursion on a
// pathological/circular structure.
const MAX_RECURSION_DEPTH = 8;

// How many files to read concurrently — parallel enough to hide the
// native-bridge round-trip latency per file, capped low enough to avoid
// holding hundreds of decoded base64 blobs in memory at once.
const READ_CONCURRENCY = 8;

const AUDIO_EXTENSIONS = ["mp3", "flac", "m4a", "ogg"];

function isAudioFile(name) {
  const ext = name.split(".").pop().toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

function mimeForExt(ext) {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function base64ToBlob(base64, mimeType) {
  // Write straight into a typed array instead of a boxed JS Array — for a
  // multi-MB audio file (run per track, concurrently across
  // READ_CONCURRENCY workers) the boxed-Array intermediate was a second,
  // much larger allocation than the final bytes actually need.
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// Keeps every music path rooted under MUSIC_FOLDER_ROOT, regardless of
// what the user types in Settings — trims slashes, strips any leading
// "storage/emulated/0/" a user might paste in, and prefixes the root back
// on if it's missing.
export function normalizeFolderPath(rawPath) {
  let path = (rawPath || "").trim().replace(/^\/+|\/+$/g, "");
  path = path.replace(/^storage\/emulated\/0\/?/i, "");
  if (!path) return DEFAULT_MUSIC_FOLDER;
  const rootLower = MUSIC_FOLDER_ROOT.toLowerCase();
  if (path.toLowerCase() === rootLower || path.toLowerCase().startsWith(`${rootLower}/`)) {
    return path;
  }
  return `${MUSIC_FOLDER_ROOT}/${path}`;
}

export async function getMusicFolderPath() {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  return value ? normalizeFolderPath(value) : DEFAULT_MUSIC_FOLDER;
}

export async function setMusicFolderPath(rawPath) {
  const normalized = normalizeFolderPath(rawPath);
  await Preferences.set({ key: STORAGE_KEY, value: normalized });
  return normalized;
}

// Whether the user has ever explicitly confirmed a music folder — the
// first-ever launch shouldn't silently scan a guessed/default path
// without the user seeing and approving it once. Separate from the path
// itself so a fresh install can't accidentally skip confirmation just
// because a path happens to already be stored.
export async function hasConfirmedFolderOnce() {
  const { value } = await Preferences.get({ key: CONFIRMED_ONCE_KEY });
  return value === "true";
}

export async function markFolderConfirmedOnce() {
  await Preferences.set({ key: CONFIRMED_ONCE_KEY, value: "true" });
}

// Requests the runtime storage permission if it hasn't been granted yet.
// Returns true if we can proceed, false if the user denied it.
export async function ensureStoragePermission() {
  const status = await Filesystem.checkPermissions();
  if (status.publicStorage === "granted") return true;
  const requested = await Filesystem.requestPermissions();
  return requested.publicStorage === "granted";
}

// Recursively walks relativePath (under musicFolder) and returns every
// audio file entry found, at any depth, with its path relative to
// musicFolder attached as `relativePath`.
async function walkAudioEntries(musicFolder, relativePath, depth = 0) {
  const fullPath = relativePath ? `${musicFolder}/${relativePath}` : musicFolder;
  let entries;
  try {
    const result = await Filesystem.readdir({ path: fullPath, directory: Directory.ExternalStorage });
    entries = result.files;
  } catch (err) {
    throw new Error(
      `Couldn't read the "${fullPath}" folder (${err.message || err}). Check the folder name is correct and contains audio files.`
    );
  }

  const found = [];
  for (const entry of entries) {
    // Skip hidden/dot-prefixed folders — a universal convention for
    // app-internal caches (e.g. video muxing temp files) that can be huge
    // and aren't music.
    if (entry.type === "directory" && entry.name.startsWith(".")) continue;
    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.type === "directory") {
      if (depth < MAX_RECURSION_DEPTH) {
        found.push(...(await walkAudioEntries(musicFolder, entryRelativePath, depth + 1)));
      }
    } else if (isAudioFile(entry.name)) {
      found.push({ ...entry, relativePath: entryRelativePath });
    }
  }
  return found;
}

async function readEntryAsFile(musicFolder, entry) {
  const ext = entry.name.split(".").pop().toLowerCase();
  const readResult = await Filesystem.readFile({
    path: `${musicFolder}/${entry.relativePath}`,
    directory: Directory.ExternalStorage,
  });
  const blob = base64ToBlob(readResult.data, mimeForExt(ext));
  const file = new File([blob], entry.name, {
    type: blob.type,
    lastModified: entry.mtime || Date.now(),
  });
  // parseLibrary/pickFolder read webkitRelativePath to derive the
  // displayed folder name — File doesn't expose it natively, so we set it
  // the same way the browser's webkitdirectory input would.
  Object.defineProperty(file, "webkitRelativePath", {
    value: `${musicFolder}/${entry.relativePath}`,
    writable: false,
  });
  return file;
}

// Reads `entries` into File objects with up to `concurrency` reads in
// flight at once — sequential awaiting one file at a time is the main
// bottleneck for large libraries (each read is a native-bridge round
// trip), but unbounded Promise.all risks holding hundreds of decoded
// files in memory simultaneously. Reports progress via onProgress(done,
// total) as each file finishes, in no particular order.
async function readEntriesWithConcurrency(musicFolder, entries, concurrency, onProgress) {
  const files = new Array(entries.length);
  let nextIndex = 0;
  let done = 0;

  async function worker() {
    while (nextIndex < entries.length) {
      const i = nextIndex++;
      files[i] = await readEntryAsFile(musicFolder, entries[i]);
      done++;
      if (onProgress) onProgress(done, entries.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => worker());
  await Promise.all(workers);
  return files;
}

// Reads every supported audio file anywhere under the currently configured
// music folder (searching subfolders, since albums are usually one level
// down) and returns them as real File objects (name, size, lastModified
// all set), so they behave identically to files picked via
// <input webkitdirectory>. Always re-reads the stored folder path, so a
// change made in Settings takes effect on the next scan without a rebuild.
// onProgress(done, total), if given, is called as each file finishes
// reading, so callers can show scan progress for large libraries.
export async function readNativeFolderAsFiles(onProgress) {
  const granted = await ensureStoragePermission();
  if (!granted) {
    throw new Error(
      "Storage permission was denied. Enable it via Settings → Apps → uPod → Permissions, then try again."
    );
  }

  const musicFolder = await getMusicFolderPath();
  const audioEntries = await walkAudioEntries(musicFolder, "");
  const files = await readEntriesWithConcurrency(musicFolder, audioEntries, READ_CONCURRENCY, onProgress);

  return { files, folderPath: musicFolder };
}
