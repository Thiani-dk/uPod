// src/online/musicbrainz.js
// Shared MusicBrainz web-service client: one global rate limiter, one
// error taxonomy, one place that knows the service's rules.
//
// Why this exists as its own module rather than inline fetches like
// trackOrder.js used to do: MusicBrainz allows roughly one request per
// second per IP, and that budget is global to the app, not per feature.
// Track-order fixing used to be the only caller and made an occasional
// pair of requests, so it got away with ignoring the limit. Per-track
// metadata lookup makes that budget contended, so every caller now has to
// queue through the same limiter or they'd collectively blow it.
//
// USER-AGENT. MusicBrainz asks for a descriptive User-Agent identifying
// the application. A WebView `fetch()` cannot set it — User-Agent is a
// forbidden header, so assigning it here would be silently dropped. The
// only place it can actually be set is the WebView's own UA string, which
// is why capacitor.config.json now carries `android.appendUserAgent`; see
// the note there. This module deliberately does NOT try to set the header
// itself, so nobody later mistakes a no-op for compliance.

// One request per second is the documented ceiling; the extra 200ms is
// slack for clock jitter and for the fact that the limiter measures from
// request *start*, not completion.
const MIN_REQUEST_INTERVAL_MS = 1200;

// A 503 from MusicBrainz is nearly always "you're going too fast" rather
// than a genuine outage, and it's worth one patient retry before giving
// up — but only one, so a sustained throttle surfaces as a real failure
// instead of hanging the UI.
const THROTTLE_RETRY_DELAY_MS = 2500;

export const LOOKUP_FAILURE = {
  NOT_FOUND: "notFound",
  NETWORK: "network",
  RATE_LIMITED: "rateLimited",
  OFFLINE: "offline",
  // MusicBrainz answers 403 with "the application you are using has not
  // identified itself" when the User-Agent isn't descriptive enough.
  // Confirmed live while building this: a bare request gets a hard 403,
  // not a throttle. Worth its own reason because retrying never fixes it
  // and it should never be reported to the user as a flaky connection —
  // it means the build's UA configuration is wrong.
  BLOCKED: "blocked",
};

// Serialises every request through a single promise chain. Each link
// waits until at least MIN_REQUEST_INTERVAL_MS has passed since the
// previous request started, so concurrent callers queue rather than
// racing. Failures don't break the chain — the `.catch` keeps the tail
// resolvable so one bad request can't wedge the limiter for the session.
let queueTail = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function schedule(task) {
  const run = queueTail.then(async () => {
    const waitFor = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    lastRequestAt = Date.now();
    return task();
  });
  queueTail = run.catch(() => {});
  return run;
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Escapes the Lucene syntax MusicBrainz's search parser uses. Without
// this, a track called "Where Is My Mind?" or anything with a stray
// bracket from a download-site filename produces a parse error rather
// than a no-match, which reads like a broken feature.
export function escapeLucene(value) {
  return (value || "").replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

// Fetches a MusicBrainz web-service path (everything after /ws/2/) and
// returns { ok: true, data } or { ok: false, failure }. Never throws, so
// callers can branch on a reason instead of wrapping every call.
export async function mbFetch(path, { retryOnThrottle = true } = {}) {
  if (isOffline()) return { ok: false, failure: LOOKUP_FAILURE.OFFLINE };

  const url = `https://musicbrainz.org/ws/2/${path}`;
  try {
    const res = await schedule(() => fetch(url, { headers: { Accept: "application/json" } }));

    if (res.status === 503 || res.status === 429) {
      if (!retryOnThrottle) return { ok: false, failure: LOOKUP_FAILURE.RATE_LIMITED };
      await sleep(THROTTLE_RETRY_DELAY_MS);
      return mbFetch(path, { retryOnThrottle: false });
    }
    if (res.status === 403) return { ok: false, failure: LOOKUP_FAILURE.BLOCKED };
    if (res.status === 404) return { ok: false, failure: LOOKUP_FAILURE.NOT_FOUND };
    if (!res.ok) return { ok: false, failure: LOOKUP_FAILURE.NETWORK };

    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, failure: LOOKUP_FAILURE.NETWORK };
  }
}
