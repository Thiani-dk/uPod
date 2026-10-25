// src/utils/instantMix.js
// The recipe behind Instant Mix.
//
// A shuffle of everything you picked is not a mix — it is a shuffle,
// and it drifts towards whatever you happen to own most of. A mix
// worth the name has a shape, so this builds one out of four
// deliberate ingredients:
//
//   favourites  the tracks from your selection you actually play. The
//               mix has to feel like yours within the first minute or
//               you skip it.
//   deep cuts   tracks from the same selection you have barely or
//               never played. This is the whole argument for owning a
//               library rather than renting one, and nothing else in
//               the app surfaces them.
//   random      a straight random draw from the selection, because a
//               mix assembled entirely out of rules is predictable in
//               a way real listening isn't.
//   wildcard    one track from anywhere in the library, outside the
//               selection entirely. It is allowed to be wrong — that
//               is what makes it worth including.
//
// Pure, and deliberately takes its randomness as an argument: the
// screen can pass Math.random, a test can pass something it controls.
import { playStatsByTrack } from "./listeningStats";

// Of the non-wildcard tracks. They do not need to be exact — the
// remainder goes to random, and a small selection can't honour them
// anyway — but the ordering matters: familiar first, because a mix
// that opens on three tracks you've never heard gets turned off.
const FAVOURITE_SHARE = 0.4;
const DEEP_CUT_SHARE = 0.25;

// Enough to be a surprise, few enough that the mix is still about what
// was asked for. Scales with length so a 50-track mix isn't carrying a
// single stray.
function wildcardCount(size) {
  return size >= 40 ? 3 : size >= 20 ? 2 : 1;
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function take(source, taken, count) {
  const picked = [];
  for (const track of source) {
    if (picked.length >= count) break;
    if (taken.has(track.id)) continue;
    taken.add(track.id);
    picked.push(track);
  }
  return picked;
}

/**
 * Builds the mix.
 *
 * `pool` is everything the user's selections resolved to; `library` is
 * the whole general pool, used only for the wildcard. Returns the
 * tracks plus a breakdown, because the screen explains what it did and
 * would otherwise have to guess at its own reasoning.
 */
export function buildMix({ pool, library, size = 25, random = Math.random, stats }) {
  const plays = stats || playStatsByTrack();
  const playCount = (track) => plays.get(track.id)?.count || 0;

  if (pool.length === 0) {
    return { tracks: [], breakdown: { favourites: 0, deepCuts: 0, random: 0, wildcards: 0 } };
  }

  const wildcards = Math.min(wildcardCount(size), Math.max(0, size - 1));
  const fromSelection = Math.max(1, size - wildcards);

  const played = pool.filter((t) => playCount(t) > 0);
  const unplayed = pool.filter((t) => playCount(t) === 0);

  // Most-played first, but shuffled within equal play counts so the
  // same selection doesn't produce the same opening every time.
  const favouriteOrder = shuffle(played, random).sort((a, b) => playCount(b) - playCount(a));
  // Never-played first, then the ones barely touched.
  const deepCutOrder = [
    ...shuffle(unplayed, random),
    ...shuffle(played, random).sort((a, b) => playCount(a) - playCount(b)),
  ];

  const taken = new Set();
  const favourites = take(favouriteOrder, taken, Math.round(fromSelection * FAVOURITE_SHARE));
  const deepCuts = take(deepCutOrder, taken, Math.round(fromSelection * DEEP_CUT_SHARE));
  // Whatever is left of the quota, drawn at random — and this is also
  // what covers a selection too small to honour the shares above.
  const rest = take(shuffle(pool, random), taken, fromSelection - favourites.length - deepCuts.length);

  const outside = library.filter((t) => !pool.some((p) => p.id === t.id) && !taken.has(t.id));
  const wild = take(shuffle(outside, random), taken, wildcards);

  // Favourites lead, then everything else interleaved, so the mix
  // opens on firm ground and loosens as it goes.
  const opening = shuffle(favourites, random);
  const body = shuffle([...deepCuts, ...rest], random);

  const tracks = [...opening, ...body];

  // The wildcard goes into the back two thirds: first position would
  // make it the thing the mix is about, and last means it may never be
  // reached.
  for (const track of wild) {
    const from = Math.floor(tracks.length / 3);
    const at = from + Math.floor(random() * Math.max(1, tracks.length - from));
    tracks.splice(at, 0, track);
  }

  return {
    tracks,
    breakdown: {
      favourites: favourites.length,
      deepCuts: deepCuts.length,
      random: rest.length,
      wildcards: wild.length,
    },
  };
}
