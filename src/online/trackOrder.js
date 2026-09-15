// src/online/trackOrder.js
// Looks up the canonical track order for an album from MusicBrainz (free,
// no key required, CORS-enabled) and fuzzy-matches it against your local
// track titles to fix track numbers — without ever touching your files,
// only the in-app metadata.
//
// Requests go through the shared client in musicbrainz.js rather than
// straight fetch: the service's ~1 req/sec budget is global to the app,
// and this is no longer the only feature spending it.
import { mbFetch, escapeLucene, LOOKUP_FAILURE } from "./musicbrainz";

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/feat\.?.*/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const lengthRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  if ((na.includes(nb) || nb.includes(na)) && lengthRatio >= 0.7) return 0.85;

  // crude trigram overlap score — this is what actually distinguishes
  // "baby blues" from "baby blues remix" once the containment shortcut
  // above no longer fires for mismatched lengths.
  const setA = new Set(na.match(/.{1,3}/g) || []);
  const setB = new Set(nb.match(/.{1,3}/g) || []);
  let overlap = 0;
  for (const g of setA) if (setB.has(g)) overlap++;
  return overlap / Math.max(setA.size, setB.size, 1);
}

// Returns [{ title, position }] for the best-matching release, or null.
export async function fetchCanonicalTrackOrder(albumTitle, artistName) {
  const query = encodeURIComponent(
    `release:"${escapeLucene(albumTitle)}" AND artist:"${escapeLucene(artistName)}"`
  );
  const search = await mbFetch(`release/?query=${query}&fmt=json&limit=5`);
  if (!search.ok) return failureToLegacyShape(search.failure);

  const release = search.data?.releases?.[0];
  if (!release) return { ok: false, notFound: true };

  const detail = await mbFetch(`release/${release.id}?inc=recordings&fmt=json`);
  if (!detail.ok) return failureToLegacyShape(detail.failure);

  const media = detail.data?.media?.[0];
  if (!media?.tracks?.length) return { ok: false, notFound: true };

  const order = media.tracks.map((t) => ({ title: t.title, position: t.position }));
  return { ok: true, order, releaseTitle: detail.data.title };
}

// The album screen already branches on { offline, notFound, error }, so
// the shared taxonomy is mapped back to that shape rather than changing a
// working UI as a side effect of this refactor. Rate limiting is reported
// as `error` because that's what the existing copy handles ("try again"),
// which is the right advice for a throttle too.
function failureToLegacyShape(failure) {
  if (failure === LOOKUP_FAILURE.OFFLINE) return { ok: false, offline: true };
  if (failure === LOOKUP_FAILURE.NOT_FOUND) return { ok: false, notFound: true };
  return { ok: false, error: true };
}

// Matches local tracks against the canonical order by title similarity.
// Returns a map of { trackId: newTrackNumber } for tracks it's confident
// about (similarity above threshold); unmatched tracks are left untouched.
export function matchTracksToOrder(localTracks, canonicalOrder, threshold = 0.62) {
  const updates = {};
  const usedPositions = new Set();

  for (const local of localTracks) {
    let best = null;
    let bestScore = 0;
    for (const candidate of canonicalOrder) {
      if (usedPositions.has(candidate.position)) continue;
      const score = similarity(local.title, candidate.title);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= threshold) {
      updates[local.id] = best.position;
      usedPositions.add(best.position);
    }
  }
  return updates;
}
