// src/online/metadataLookup.js
// Identifies a track against MusicBrainz's recording database and returns
// ranked candidates for a human to choose from. Deliberately does not
// decide anything itself: an automatic "best match" is exactly how badly
// tagged libraries get silently corrupted, and the whole point of the
// cleaner flow is that a person confirms the answer.
//
// This is the text-search half of identification. It works from whatever
// the file already claims (tags, or a filename when tags are absent),
// which is enough for most real music and useless for audio that was
// never published — see PLAN-metadata-cleaner.md for why fingerprinting
// doesn't rescue the latter case either.
import { mbFetch, escapeLucene, LOOKUP_FAILURE, isOffline } from "./musicbrainz";

export { LOOKUP_FAILURE };

// How many candidates to ask for. Small on purpose: this list is rendered
// as cards a person reads one by one, and MusicBrainz's relevance drops
// off steeply, so a longer list is more scrolling rather than more signal.
const CANDIDATE_LIMIT = 8;

// How many to *fetch* before ranking. Ranking can only reorder what the
// page contains, and MusicBrainz orders purely by text relevance: a search
// for "Numb" by Linkin Park matches 84 recordings and the first six are
// all live versions, so asking for six and sorting them still shows six
// live versions. Fetching a wider page and ranking it down to
// CANDIDATE_LIMIT is what actually surfaces the studio recording, and it
// costs the same single request.
const SEARCH_FETCH_LIMIT = 40;

// Below this MusicBrainz relevance score a "match" is usually a coincidental
// word overlap rather than the same recording. Kept low enough that a
// genuine match with messy input still survives, since the user makes the
// final call anyway.
const MIN_SCORE = 50;

// Strips the noise that download sites and rippers bake into filenames and
// tags, so what reaches the search parser resembles a song title. A
// superset of the cleanup lyrics.js already does for its own lookups —
// this one also has to cope with leading track numbers, since it's often
// working from a bare filename rather than a real title tag.
export function cleanForSearch(raw) {
  return (raw || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\[.*?\]/g, " ")
    .replace(/\((?:official|lyric|audio|video|hd|hq|explicit)[^)]*\)/gi, " ")
    .replace(/\b(?:official\s+)?(?:music\s+)?video\b/gi, " ")
    .replace(/\b\d{2,3}\s*kbps\b/gi, " ")
    .replace(/-?\s*\d{2,3}k\b/gi, " ")
    .replace(/\bwww\.[^\s]+/gi, " ")
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Splits an "Artist - Title" style filename. Returns nulls when there's no
// separator rather than guessing, so callers can fall back to searching the
// whole string as a title.
export function splitArtistTitle(raw) {
  const cleaned = cleanForSearch(raw);
  const m = cleaned.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (!m) return { artist: null, title: cleaned };
  return { artist: m[1].trim(), title: m[2].trim() };
}

// A release is "canonical" when it's an official studio album rather than
// a live record, compilation, soundtrack or remix album. MusicBrainz says
// this in structured fields — release-group.primary-type plus
// secondary-types — which the recording *search* response already inlines
// (verified against the live API), so no extra request is needed.
// Matching on those beats pattern-matching release titles, which can't
// tell "Live in Hong Kong" from an album that merely has "live" in its
// name.
const SECONDARY_TYPES_TO_AVOID = new Set(["Live", "Compilation", "Remix", "Soundtrack", "Demo", "Interview", "Mixtape/Street", "DJ-mix"]);

function releaseRank(release) {
  const rg = release?.["release-group"] || {};
  const secondary = rg["secondary-types"] || [];
  let rank = 0;
  if (rg["primary-type"] === "Album") rank -= 4;
  if (rg["primary-type"] === "Single" || rg["primary-type"] === "EP") rank -= 2;
  if (secondary.some((t) => SECONDARY_TYPES_TO_AVOID.has(t))) rank += 5;
  if (release?.status !== "Official") rank += 2;
  if (!release?.date) rank += 1;
  return rank;
}

// The same recording is often attached to a dozen releases (the album, a
// greatest-hits, three live records). Show the one a person would
// recognise, not whichever MusicBrainz happened to list first.
function pickBestRelease(releases) {
  if (!releases || releases.length === 0) return null;
  return [...releases].sort((a, b) => releaseRank(a) - releaseRank(b) || (a.date || "9999").localeCompare(b.date || "9999"))[0];
}

// Turns one MusicBrainz recording into the flat shape the UI renders.
// `disambiguation` is carried through deliberately — it's usually the only
// thing distinguishing five identically-named candidates ("live, 2003",
// "radio edit"), and dropping it would make the list unreadable.
function toCandidate(recording) {
  const credit = recording["artist-credit"]?.[0];
  const release = pickBestRelease(recording.releases);
  const rg = release?.["release-group"] || {};
  return {
    recordingId: recording.id,
    title: recording.title,
    artist: credit?.name || credit?.artist?.name || "",
    artistId: credit?.artist?.id || null,
    album: release?.title || "",
    releaseId: release?.id || null,
    releaseGroupId: rg.id || null,
    year: (release?.date || "").slice(0, 4) || "",
    disambiguation: recording.disambiguation || "",
    durationMs: recording.length || null,
    score: recording.score ?? 0,
    // Kept so the picker can label a candidate ("Live album") instead of
    // making the user infer it from the release title.
    releaseType: rg["primary-type"] || "",
    releaseSecondaryTypes: rg["secondary-types"] || [],
    rank: release ? releaseRank(release) : 99,
  };
}

// Score first (MusicBrainz's own relevance is still the strongest signal),
// then the structured release rank so a studio album beats a live take at
// equal relevance. A recording whose disambiguation says "live" is pushed
// down too, for the cases where the release metadata alone doesn't say so.
function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.rank !== b.rank) return a.rank - b.rank;
  const liveish = /\b(live|demo|karaoke|instrumental|rehearsal)\b/i;
  return Number(liveish.test(a.disambiguation)) - Number(liveish.test(b.disambiguation));
}

function buildQuery({ title, artist }) {
  const parts = [`recording:"${escapeLucene(title)}"`];
  if (artist) parts.push(`artist:"${escapeLucene(artist)}"`);
  return parts.join(" AND ");
}

// Looks up candidates for `track`. Uses its tags when they look usable and
// falls back to parsing the filename when they don't — a track whose
// "title" is just the filename is the normal case for the files this
// feature exists to clean up.
//
// Returns { ok: true, candidates, query } or { ok: false, failure }.
// An empty result is NOT_FOUND rather than an empty success, so the UI
// renders a real "nothing matched" state instead of a blank list.
export async function lookupTrackMetadata(track, { limit = CANDIDATE_LIMIT } = {}) {
  if (!track) return { ok: false, failure: LOOKUP_FAILURE.NOT_FOUND };
  if (isOffline()) return { ok: false, failure: LOOKUP_FAILURE.OFFLINE };

  const search = deriveSearchTerms(track);
  if (!search.title) return { ok: false, failure: LOOKUP_FAILURE.NOT_FOUND };

  const query = buildQuery(search);
  const res = await mbFetch(
    `recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${SEARCH_FETCH_LIMIT}&inc=releases`
  );
  if (!res.ok) return res;

  const candidates = (res.data?.recordings || [])
    .map(toCandidate)
    .filter((c) => c.score >= MIN_SCORE && c.title)
    .sort(compareCandidates)
    .slice(0, limit);

  if (candidates.length === 0) return { ok: false, failure: LOOKUP_FAILURE.NOT_FOUND, query: search };
  return { ok: true, candidates, query: search };
}

// What to actually search for. Prefers real tags; falls back to the
// filename when the tag is obviously just the filename echoed back (which
// is what parseNativeTrackDescriptor does when a file has no tags at all).
export function deriveSearchTerms(track) {
  const tagTitle = cleanForSearch(track.title);
  const tagArtist = cleanForSearch(track.artist);
  const artistLooksReal = tagArtist && !/^unknown/i.test(tagArtist);

  if (tagTitle && artistLooksReal) return { title: tagTitle, artist: tagArtist };

  // No usable artist tag — try to recover both halves from the path, which
  // is where "Artist - Title.mp3" downloads keep them.
  const fromName = splitArtistTitle(track.relativePath?.split("/").pop() || track.title || "");
  return {
    title: fromName.title || tagTitle,
    artist: fromName.artist || (artistLooksReal ? tagArtist : null),
  };
}
