// src/online/lyricsPrefetch.js
// Walks the library in the background and fills in lyrics for every track
// that doesn't have them yet, so Karaoke has something to show the moment
// it's opened — including with no connection, which is the whole point.
// Nothing here is ever on the path of a user action: it starts after the
// library is on screen, yields between tracks, and stops the instant the
// connection drops or the library changes under it.
//
// Studio renders are skipped by design. A slowed/reverbed render is the
// same recording stretched, so the source track's lyrics no longer line
// up with it, and there is nothing online to look up for a file that only
// exists on this device.
//
// Pacing. LRCLIB and lyrics.ovh are free services with no key and no
// published quota, and a sweep over a few hundred tracks is a few hundred
// requests at worst. One track at a time with a deliberate gap between
// them keeps that to a trickle rather than a burst that gets the device
// rate-limited out of finding anything; a 429 backs the whole sweep off
// rather than pushing through it.
import { resolveLyricsOnline, loadAnyCachedLyrics, LYRICS_FAILURE, getGeminiKey } from "./lyrics";
import { loadLyricsIndex, recordLyricsAttempt, clearLyricsAttempt } from "../audio/libraryCache";

// Gap between tracks. Lyrics are nice to have in advance, not urgent, and
// a sweep that finishes in ten minutes instead of two costs the user
// nothing while being far gentler on services nobody is paying for.
const PACE_MS = 900;
// How long to wait out a rate-limit before resuming. LRCLIB's limiter
// clears in well under this; a longer pause costs nothing here.
const RATE_LIMIT_BACKOFF_MS = 60 * 1000;
// Consecutive transport failures that mean the connection is effectively
// gone even though navigator.onLine still says otherwise (captive portal,
// dead mobile data). The sweep stops and waits to be restarted rather
// than grinding through the whole library failing.
const NETWORK_FAILURE_LIMIT = 4;
// How often a track that genuinely isn't in any database may be retried,
// by attempt count. A new release that nobody has transcribed yet does
// turn up later, so "not found" is never permanent — it just becomes
// progressively less eager. Beyond the last entry, the last value repeats.
const NOT_FOUND_RETRY_AFTER_MS = [
  6 * 60 * 60 * 1000, //  1st miss: later today
  3 * 24 * 60 * 60 * 1000, //  2nd: in a few days
  14 * 24 * 60 * 60 * 1000, //  3rd: a fortnight
  60 * 24 * 60 * 60 * 1000, //  4th and after: every couple of months
];
// An infrastructure failure says nothing about the track, so it's retried
// on the next sweep rather than backed off.
const INFRA_RETRY_AFTER_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFor(attempt) {
  if (!attempt) return 0;
  if (attempt.failure && attempt.failure !== LYRICS_FAILURE.NOT_FOUND) return INFRA_RETRY_AFTER_MS;
  const index = Math.min(attempt.attempts || 1, NOT_FOUND_RETRY_AFTER_MS.length) - 1;
  return NOT_FOUND_RETRY_AFTER_MS[index];
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isPrefetchableTrack(track) {
  return Boolean(track) && !track.isStudioRender;
}

// One sweep at a time, process-wide. A second request to sweep while one
// is running is a no-op rather than a second queue of requests racing the
// first through the same rate limits.
let current = null;

// Starts (or re-uses) a sweep over `tracks`. `onProgress` is called with
// { total, pending, done, found, running } as it goes — that's what the
// Settings row renders. Returns a handle with cancel().
export function startLyricsSweep(tracks, { onProgress, allowAi = true } = {}) {
  if (current) return current;

  let cancelled = false;
  const handle = {
    cancel() {
      cancelled = true;
      if (current === handle) current = null;
    },
  };
  current = handle;

  const report = (patch) => {
    if (onProgress && !cancelled) onProgress(patch);
  };

  (async () => {
    try {
      const candidates = tracks.filter(isPrefetchableTrack);
      const index = await loadLyricsIndex();
      const now = Date.now();

      // Already covered: anything with sourced, manual or AI lyrics. A
      // track whose only lyrics are an AI reconstruction is deliberately
      // still queued — a real database match is strictly better, and the
      // reconstruction stays as the fallback until one turns up.
      const covered = candidates.filter(
        (t) => index.sourced.has(t.id) || index.manual.has(t.id)
      ).length;

      const queue = candidates.filter((t) => {
        if (index.sourced.has(t.id) || index.manual.has(t.id)) return false;
        const attempt = index.attempts.get(t.id);
        if (!attempt) return true;
        // An AI reconstruction already on file means the track isn't
        // empty in Karaoke, so it waits for the slow retry schedule
        // rather than being asked about on every sweep.
        const delay = retryDelayFor(attempt) * (index.ai.has(t.id) ? 2 : 1);
        return now - (attempt.lastAttemptAt || 0) >= delay;
      });

      let done = 0;
      let found = covered;
      let networkFailures = 0;
      report({ total: candidates.length, pending: queue.length, done, found, running: true });

      for (const track of queue) {
        if (cancelled) break;
        if (isOffline()) break;

        // Re-checked per track, not just in bulk up front: the user may
        // have opened Karaoke on this very track mid-sweep and found (or
        // pasted) its lyrics already.
        if (await loadAnyCachedLyrics(track.id)) {
          done++;
          found++;
          report({ total: candidates.length, pending: queue.length, done, found, running: true });
          continue;
        }

        const result = await resolveLyricsOnline(track, {
          // Only as a last resort, only with the user's own key, and only
          // in the background sweep where there's time for it.
          allowAi: allowAi && Boolean(getGeminiKey()),
          allowMusicBrainz: true,
        });

        if (result.ok) {
          found++;
          networkFailures = 0;
          await clearLyricsAttempt(track.id);
        } else {
          await recordLyricsAttempt(track.id, result.failure);
          if (result.failure === LYRICS_FAILURE.RATE_LIMITED) {
            report({ total: candidates.length, pending: queue.length, done, found, running: true, throttled: true });
            await sleep(RATE_LIMIT_BACKOFF_MS);
          } else if (result.failure === LYRICS_FAILURE.NETWORK) {
            networkFailures++;
            if (networkFailures >= NETWORK_FAILURE_LIMIT) break;
          } else {
            networkFailures = 0;
          }
        }

        done++;
        report({ total: candidates.length, pending: queue.length, done, found, running: true });
        if (cancelled) break;
        await sleep(PACE_MS);
      }

      report({ total: candidates.length, pending: Math.max(0, queue.length - done), done, found, running: false });
    } catch (err) {
      console.warn("[upod] lyrics sweep stopped:", err);
      report({ running: false });
    } finally {
      if (current === handle) current = null;
    }
  })();

  return handle;
}

export function cancelLyricsSweep() {
  current?.cancel();
}

// Coverage without starting anything — what the Settings row shows before
// a sweep has run, and after one finishes.
export async function lyricsCoverage(tracks) {
  const candidates = tracks.filter(isPrefetchableTrack);
  const index = await loadLyricsIndex();
  let found = 0;
  let reconstructed = 0;
  for (const t of candidates) {
    if (index.sourced.has(t.id) || index.manual.has(t.id)) found++;
    else if (index.ai.has(t.id)) reconstructed++;
  }
  return { total: candidates.length, found, reconstructed };
}
