// src/download/audioDownload.js
// JS-side handle for AudioDownloadPlugin.java. The plugin reports a job's
// life by events rather than by resolving start(), because a download
// outlives the sheet that asked for it — so this keeps a small registry
// of in-flight jobs and routes each event to the right caller's handlers.
import { registerPlugin, Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { getMusicFolderPath } from "../audio/nativeFolder";

export const AudioDownload = registerPlugin("AudioDownload");

// @capacitor/filesystem addresses shared storage by Directory alias, but
// yt-dlp is a native process that only understands real paths — and on
// every Android device the primary shared volume is mounted here
// regardless of which physical storage backs it.
const SHARED_STORAGE_ROOT = "/storage/emulated/0";

const jobs = new Map();
let bound = false;

function bindOnce() {
  if (bound) return;
  bound = true;
  AudioDownload.addListener("progress", (ev) => {
    jobs.get(ev?.id)?.onProgress?.(ev);
  });
  AudioDownload.addListener("done", (ev) => {
    const job = jobs.get(ev?.id);
    jobs.delete(ev?.id);
    job?.onDone?.(ev);
  });
  AudioDownload.addListener("failed", (ev) => {
    const job = jobs.get(ev?.id);
    jobs.delete(ev?.id);
    job?.onFailed?.(ev);
  });
}

const LAST_UPDATE_KEY = "upod_ytdlp_last_update";
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

// Unpacks the bundled Python/ffmpeg if that hasn't happened yet. Worth
// calling when the quality sheet opens: the first-ever download would
// otherwise appear to stall for several seconds before any progress,
// with nothing to say why.
export async function prepareEngine() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AudioDownload.prepare();
  } catch {
    return;
  }
  maybeAutoUpdate();
}

// Keeping yt-dlp current is not housekeeping here, it is the difference
// between working and not: YouTube changes its player often enough that
// the copy baked into any given APK build starts returning "HTTP Error
// 403: Forbidden" on every download within weeks. Observed on this
// phone with a freshly built APK, which is why this runs on its own
// rather than waiting to be asked.
//
// Throttled to a day, and deliberately fire-and-forget — a failed
// update (offline, say) must not stop a download that might still work.
async function maybeAutoUpdate() {
  try {
    const { value } = await Preferences.get({ key: LAST_UPDATE_KEY });
    const last = value ? Number(value) : 0;
    if (Date.now() - last < UPDATE_EVERY_MS) return;
    await AudioDownload.update();
    await Preferences.set({ key: LAST_UPDATE_KEY, value: String(Date.now()) });
  } catch {
    // Offline or the update endpoint is unhappy; the bundled yt-dlp
    // still gets its chance.
  }
}

// The shade's half of "your download finished". Only called when uPod
// isn't in front of the user — in-app the arrival card says it instead,
// and two announcements of the same event is one too many. See
// AudioDownloadPlugin.notifyBatchComplete for what it renders.
export async function notifyDownloadsFinished({ title, text, lines, jobIds }) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AudioDownload.notifyBatchComplete({ title, text, lines: lines || [], jobIds: jobIds || [] });
  } catch (err) {
    console.warn("Couldn't post the downloads-finished notification:", err);
  }
}

// Takes the batch's notifications out of the shade — either because the
// app was in the foreground the whole time, or because the review they
// point at has now been dealt with.
export async function clearDownloadNotifications(jobIds) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AudioDownload.clearNotifications({ jobIds: jobIds || [] });
  } catch {
    /* nothing in the shade to clear, or no permission — either way fine */
  }
}

// Fires when uPod was opened (cold or warm) by a tap on that
// notification. Same two-path shape as onSharedUrl in utils/shareTarget.js
// and for the same reason: a tap that launched the process happened
// before any of this code existed, so it has to be collected rather than
// listened for.
export function onDownloadReviewRequest(handler) {
  if (!Capacitor.isNativePlatform()) return () => {};

  let live = true;
  AudioDownload.getPendingReview()
    .then((res) => {
      if (live && res?.pending) handler();
    })
    .catch(() => {});

  const sub = AudioDownload.addListener("reviewRequested", () => {
    if (live) handler();
  });

  return () => {
    live = false;
    sub.then?.((s) => s.remove()) ?? sub.remove?.();
  };
}

// Pulls a fresher yt-dlp than the one baked into the APK. YouTube breaks
// extractors often enough that this is the first thing to try when
// downloads start failing across the board.
export function updateEngine() {
  return AudioDownload.update();
}

// Minted by the caller so the UI can put a row on screen *before* the
// job is queued. Registering the row afterwards would race: a short
// download can report done before the await on start() has even
// resumed, and that event would land on a row that doesn't exist yet,
// leaving it stuck showing progress for something already finished.
export function newDownloadId() {
  return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Runs a YouTube search without downloading, returning the parsed
// candidates. Used to find the YouTube upload of a track that was shared
// as a Spotify link — see spotify.js for why that indirection exists.
export async function searchYouTube(query, limit = 5) {
  const res = await AudioDownload.search({ query, limit });
  return (res?.results || [])
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Starts a download and resolves once queued — not once finished.
// Progress and the outcome arrive through the handlers.
export async function downloadAudio(id, url, preset, handlers = {}, { outputName } = {}) {
  bindOnce();
  jobs.set(id, handlers);

  // Straight into the folder the library already scans, so a finished
  // download is picked up by the same checkForNewMusic path that notices
  // files added over USB — no separate inbox to reconcile.
  const folder = await getMusicFolderPath();

  try {
    await AudioDownload.start({
      id,
      url,
      directory: `${SHARED_STORAGE_ROOT}/${folder}`,
      format: preset.format,
      recode: preset.recode ?? null,
      outputName: outputName ?? null,
    });
  } catch (err) {
    jobs.delete(id);
    throw err;
  }
  return id;
}
