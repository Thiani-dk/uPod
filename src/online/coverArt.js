// src/online/coverArt.js
// Fetches cover art for a confirmed MusicBrainz match from the Cover Art
// Archive.
//
// Strictly a bonus of a successful match, never a success criterion.
// Coverage is genuinely patchy — probing real release MBIDs during
// scoping returned 404 more often than not — so callers must treat "no
// art" as normal and must never let it turn a good match into a failure.
//
// CAA is CORS-enabled (verified) and needs no key. It's a separate host
// from the MusicBrainz web service and has its own capacity, so these
// requests deliberately do NOT go through the mbFetch rate limiter —
// queueing image fetches behind the 1 req/sec search budget would make a
// match feel slow for something optional.
const CAA_BASE = "https://coverartarchive.org";

// 500px is the largest thumbnail CAA generates for every image that has
// one, and it's already above the 480px cap libraryCache downscales to,
// so asking for the full-size original would only mean downloading a
// multi-megabyte scan to immediately shrink it.
const THUMB = "500";

async function tryFetchImage(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: blob.type || "image/jpeg" };
  } catch {
    return null;
  }
}

// Returns { bytes, format } or null. Tries the specific release first,
// then the release group: a release group almost always has art even when
// the particular pressing the recording was matched to doesn't, so
// falling back materially raises the hit rate for one extra request that
// only happens when the first attempt missed.
export async function fetchCoverArt({ releaseId, releaseGroupId }) {
  if (releaseId) {
    const art = await tryFetchImage(`${CAA_BASE}/release/${releaseId}/front-${THUMB}`);
    if (art) return art;
  }
  if (releaseGroupId) {
    const art = await tryFetchImage(`${CAA_BASE}/release-group/${releaseGroupId}/front-${THUMB}`);
    if (art) return art;
  }
  return null;
}
