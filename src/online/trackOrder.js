// src/online/trackOrder.js
// Looks up the canonical track order for an album from MusicBrainz (free,
// no key required, CORS-enabled) and fuzzy-matches it against your local
// track titles to fix track numbers — without ever touching your files,
// only the in-app metadata.

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

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MusicBrainz request failed (${res.status})`);
  return res.json();
}

// Returns [{ title, position }] for the best-matching release, or null.
export async function fetchCanonicalTrackOrder(albumTitle, artistName) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, offline: true };
  }
  try {
    const query = encodeURIComponent(`release:"${albumTitle}" AND artist:"${artistName}"`);
    const searchUrl = `https://musicbrainz.org/ws/2/release/?query=${query}&fmt=json&limit=5`;
    const searchData = await fetchJson(searchUrl);
    const release = searchData?.releases?.[0];
    if (!release) return { ok: false, notFound: true };

    const releaseUrl = `https://musicbrainz.org/ws/2/release/${release.id}?inc=recordings&fmt=json`;
    const releaseData = await fetchJson(releaseUrl);
    const media = releaseData?.media?.[0];
    if (!media?.tracks?.length) return { ok: false, notFound: true };

    const order = media.tracks.map((t) => ({ title: t.title, position: t.position }));
    return { ok: true, order, releaseTitle: releaseData.title };
  } catch {
    return { ok: false, error: true };
  }
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
