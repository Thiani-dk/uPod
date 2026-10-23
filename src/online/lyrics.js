// src/online/lyrics.js
// Finds lyrics for a track and keeps them offline afterwards.
//
// The lookup is a cascade, not a single request, because the thing that
// actually makes lyrics lookups fail is almost never "the song has no
// lyrics anywhere" — it's that the strings a downloaded file carries
// ("[MP3DL.CC] Burna Boy - Last Last (Official Video)-192k") are not the
// strings a lyrics database is keyed by. So each source is asked several
// times with progressively more aggressive interpretations of the tags,
// and only a clean miss from every variant of every source counts as
// NOT_FOUND:
//
//   1. LRCLIB exact get, per candidate artist/title pair
//   2. LRCLIB fuzzy search, per candidate, scored against the candidate
//      rather than trusting the first row
//   3. lyrics.ovh, per candidate
//   4. MusicBrainz canonicalisation — ask what this recording is really
//      called, then go back to 1 with the canonical artist/title
//   5. an AI reconstruction, only if the user has supplied a key
//
// WHAT GETS CACHED:
//   - lyrics from LRCLIB / lyrics.ovh  -> the sourced cache (LYRICS_STORE)
//   - the user's own pasted lyrics     -> the manual store, their data
//   - AI reconstructions               -> their own third store, and
//     labelled everywhere they're read. They are persisted (which they
//     weren't originally) because lyrics that vanish the moment the
//     connection does are not much use in a karaoke screen, and asking a
//     model again on every launch is slower and less consistent than
//     keeping the one answer. The sourced cache stays pure either way:
//     nothing synthesised is ever written to it, so "found" and "guessed"
//     can't be confused for each other.
//
// Results are keyed by track id rather than artist+title so two files
// that share sloppy tags can't collide, and so a retag doesn't orphan the
// cached entry.
import {
  saveCachedLyrics,
  loadCachedLyrics,
  saveManualLyricsRecord,
  loadManualLyricsRecord,
  saveAiLyrics,
  loadAiLyrics,
} from "../audio/libraryCache";
import { lookupTrackMetadata, deriveSearchTerms, cleanForSearch as cleanDeep, splitArtistTitle } from "./metadataLookup";

// Strips common noise from downloaded-file artist/title strings before
// searching, e.g. "[MP3DL.CC] Artist - Song (Cover)-192k" -> "Song".
function cleanForSearch(str) {
  return (str || "")
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?(cover|remix|freestyle|leak|lyrics).*?\)/gi, "")
    .replace(/-?\d{2,3}k$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Featured-artist credits are the single most common reason an otherwise
// exact title misses: LRCLIB stores "Last Last", the file says "Last Last
// (feat. Someone)". Dropped from the title, and reduced to the primary
// name in the artist field.
function stripFeatures(str) {
  return (str || "")
    .replace(/\s*[([{]\s*(?:feat|ft|featuring|with)\b[^)\]}]*[)\]}]?/gi, " ")
    .replace(/\s+(?:feat|ft|featuring)\.?\s+.*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function primaryArtist(str) {
  return stripFeatures(str)
    .split(/\s*(?:,|&|\bx\b|\bvs\.?\b|\band\b|\/)\s*/i)[0]
    .trim();
}

// Trailing qualifiers a database row generally doesn't carry: version
// labels, remaster notes, bitrate tails, "official audio".
function stripQualifiers(str) {
  return (str || "")
    .replace(/\s*[([{][^)\]}]*(?:official|video|audio|lyric|lyrics|hd|hq|explicit|clean|remaster(?:ed)?|version|edit|mix|bonus|live|visuali[sz]er)[^)\]}]*[)\]}]/gi, " ")
    .replace(/\s*-\s*(?:official|lyric|lyrics|audio|video|remaster(?:ed)?)\b.*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const LYRICS_FAILURE = {
  NOT_FOUND: "notFound",
  NETWORK: "network",
  RATE_LIMITED: "rateLimited",
  OFFLINE: "offline",
};

// Below this, a fuzzy search row is a coincidental word overlap rather
// than the same song. Tuned on real rows: "Last Last" vs "Last Last
// (feat...)" scores well above it, "Last" vs "The Last Of Us" does not.
const FUZZY_MATCH_FLOOR = 0.62;

function normalizeForCompare(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Token overlap (Dice coefficient over word sets), not edit distance:
// what differs between a file's title and a database row is usually whole
// extra words ("feat", "remastered", "official") rather than typos, and
// word-set overlap handles that without punishing a long title for one
// missing word the way a character-level distance does.
function similarity(a, b) {
  const aTokens = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared++;
  return (2 * shared) / (aTokens.size + bTokens.size);
}

// Every artist/title pair worth asking a database about, best guess
// first, de-duplicated. Order matters: the first hit wins, so the most
// faithful reading of the tags is tried before the aggressive ones.
export function lyricsSearchCandidates(track) {
  const pairs = [];
  const push = (artist, title, flags) => {
    const a = (artist || "").trim();
    const t = (title || "").trim();
    // A title alone is still worth searching (LRCLIB's search endpoint
    // accepts a bare track name); an artist alone is not.
    if (!t || t.length < 2) return;
    // A single word with no artist behind it is not evidence. Tested
    // live: a file called "nope.mp3" with unrelated tags matched a song
    // actually called "Nope" and would have been handed those lyrics with
    // full confidence. Title-only searching stays available for these
    // through the MusicBrainz step below, which answers with an artist
    // attached and so can be checked.
    if (!a && !/\s/.test(t)) return;
    if (pairs.some((p) => p.artist.toLowerCase() === a.toLowerCase() && p.title.toLowerCase() === t.toLowerCase())) return;
    pairs.push({ artist: a, title: t, ...flags });
  };

  const tagArtist = cleanForSearch(track.artist);
  const tagTitle = cleanForSearch(track.title);
  const artistIsReal = tagArtist && !/^unknown/i.test(tagArtist);

  // Cleanest reading first, not the most literal one. Every candidate
  // gets tried either way, so the order only decides how many requests it
  // takes to get to the hit — and a database is keyed by the canonical
  // name, so "Last Last" is a better opening bid than "Last Last
  // (Official Video)".
  push(primaryArtist(tagArtist), stripQualifiers(stripFeatures(tagTitle)));
  push(artistIsReal ? tagArtist : "", tagTitle);
  push(primaryArtist(tagArtist), stripFeatures(tagTitle));

  // The filename is often the only place the real artist survives — tags
  // on a downloaded file are frequently the site's name or nothing.
  const fileName = track.relativePath?.split("/").pop() || "";
  if (fileName) {
    const fromName = splitArtistTitle(fileName);
    if (fromName.title) {
      push(fromName.artist || (artistIsReal ? tagArtist : ""), stripFeatures(fromName.title));
      push(primaryArtist(fromName.artist || ""), stripQualifiers(stripFeatures(fromName.title)));
      // "Song - Artist.mp3" is as common as the other way round, and
      // there's no way to tell which from the string alone — so try both
      // rather than silently assuming. Flagged, because a reversed
      // reading is only safe as an exact lookup: LRCLIB does contain rows
      // with the two fields the wrong way round (karaoke compilations are
      // full of them), and both halves having to match a single row is
      // what keeps that from turning into a plausible-looking fuzzy match
      // on an unrelated song.
      if (fromName.artist) push(stripFeatures(fromName.title), primaryArtist(fromName.artist), { swapped: true });
    }
  }

  // Last resort: the deep cleaner used for MusicBrainz searches, which
  // also strips leading track numbers and URL fragments.
  push(primaryArtist(cleanDeep(track.artist)), stripQualifiers(cleanDeep(track.title)));

  return pairs.filter((p) => p.title);
}

export async function fetchLyricsOnline(track, { allowAi = false, allowMusicBrainz = true } = {}) {
  if (!track) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

  const cached = await loadAnyCachedLyrics(track.id);
  if (cached) return cached;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, failure: LYRICS_FAILURE.OFFLINE };
  }

  return resolveLyricsOnline(track, { allowAi, allowMusicBrainz });
}

// The cache side of the lookup on its own — what Karaoke needs to know
// whether it can render something with no connection, and what the sweep
// checks before spending a request.
export async function loadAnyCachedLyrics(trackId) {
  if (!trackId) return null;
  // The user's own paste wins over everything — if they bothered to type
  // it in for this track, that's what they want to see.
  const manual = await loadManualLyricsRecord(trackId);
  if (manual) {
    return { ok: true, lyrics: manual.lyrics, synced: null, source: "manual", fromCache: true };
  }
  const sourced = await loadCachedLyrics(trackId);
  if (sourced) return { ...sourced, fromCache: true };
  // Deliberately last: a real lookup that succeeds later should replace a
  // reconstruction, which is why the sweep keeps looking for tracks that
  // only have this.
  const ai = await loadAiLyrics(trackId);
  if (ai) return { ok: true, lyrics: ai.lyrics, synced: null, source: ai.source, ai: true, fromCache: true };
  return null;
}

// The network half, with no cache read of its own — the sweep has already
// done that in bulk by the time it calls here. Writes through to the
// right store on success.
export async function resolveLyricsOnline(track, { allowAi = false, allowMusicBrainz = true } = {}) {
  const candidates = lyricsSearchCandidates(track);
  // Nothing usable to search on (a track with no tags and no filename at
  // all) — that's a no-match, not a failure of the lookup.
  if (candidates.length === 0) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

  // Tracks whether any source failed for an infrastructure reason rather
  // than simply not having the song. If every source cleanly said "no
  // match", this stays null and the result is an honest NOT_FOUND.
  let infraFailure = null;
  const note = (failure) => {
    if (failure && failure !== LYRICS_FAILURE.NOT_FOUND && !infraFailure) infraFailure = failure;
  };

  const attempt = async (pairs) => {
    // Breadth-first across sources rather than depth-first across
    // candidates: an exact LRCLIB hit on the third candidate is a better
    // answer than a fuzzy one on the first, and LRCLIB's synced lyrics
    // beat anything lyrics.ovh can return.
    for (const { artist, title } of pairs) {
      if (!artist) continue;
      const got = await tryLrclibExact(artist, title);
      if (got.ok) return got;
      note(got.failure);
      if (infraFailure === LYRICS_FAILURE.RATE_LIMITED) break;
    }
    for (const { artist, title, swapped } of pairs) {
      if (swapped) continue; // exact-only — see lyricsSearchCandidates
      const got = await tryLrclibSearch(artist, title);
      if (got.ok) return got;
      note(got.failure);
      if (infraFailure === LYRICS_FAILURE.RATE_LIMITED) break;
    }
    for (const { artist, title, swapped } of pairs) {
      if (!artist || swapped) continue;
      const got = await tryLyricsOvh(artist, title);
      if (got.ok) return got;
      note(got.failure);
    }
    return null;
  };

  let found = await attempt(candidates);

  // Still nothing: ask MusicBrainz what this recording actually is. This
  // is the step that rescues mistagged files — the lyrics databases only
  // know canonical names, and MusicBrainz is the thing that can map
  // "Burna Boy - last last (prod. chopstix)" onto "Last Last". Its own
  // client rate-limits to ~1 req/s, so this is one request, and only for
  // tracks nothing else could find.
  // Deliberately not gated on infraFailure: a single 503 from LRCLIB used
  // to skip this step entirely, which threw away the one lookup most
  // likely to rescue a mistagged file. A real rate limit is the exception
  // — nothing downstream of it is going to answer either.
  if (!found && allowMusicBrainz && infraFailure !== LYRICS_FAILURE.RATE_LIMITED) {
    const canonical = await canonicalNamesFor(track);
    if (canonical.length > 0) {
      found = await attempt(canonical);
      if (found) found = { ...found, canonicalised: true };
    }
  }

  if (found) {
    await saveCachedLyrics(track.id, stripRuntimeFields(found));
    return found;
  }

  // Only once every database has cleanly said no, and only with a key the
  // user supplied themselves.
  if (allowAi && infraFailure !== LYRICS_FAILURE.RATE_LIMITED && getGeminiKey()) {
    const ai = await fetchLyricsFromGemini(track);
    if (ai.ok) return ai;
    note(ai.failure);
  }

  return { ok: false, failure: infraFailure || LYRICS_FAILURE.NOT_FOUND };
}

// MusicBrainz's view of what this file is, as extra artist/title pairs to
// search with. Takes the top candidates rather than deciding anything:
// the pairs are only used to query a lyrics database, and a wrong guess
// there costs a miss, not a corrupted tag.
async function canonicalNamesFor(track) {
  const terms = deriveSearchTerms(track);
  if (!terms.title) return [];
  const res = await lookupTrackMetadata(track, { limit: 3 });
  if (!res.ok) return [];
  const pairs = [];
  for (const c of res.candidates) {
    if (!c.title || !c.artist) continue;
    // Guard against MusicBrainz's text search drifting onto a different
    // song entirely, which it will happily do for a two-word title.
    if (similarity(c.title, terms.title) < 0.5) continue;
    pairs.push({ artist: c.artist, title: c.title });
    pairs.push({ artist: primaryArtist(c.artist), title: stripFeatures(c.title) });
  }
  return pairs;
}

// `fromCache`/`canonicalised` are per-call display details, not part of
// the stored entry.
function stripRuntimeFields({ fromCache, canonicalised, ...entry }) {
  return entry;
}

function entryFromLrclib(data, { fuzzy = false } = {}) {
  return {
    ok: true,
    lyrics: data.plainLyrics || stripLrcTimestamps(data.syncedLyrics),
    synced: data.syncedLyrics || null,
    source: fuzzy ? "LRCLIB (fuzzy match)" : "LRCLIB",
    matchedAs: data.artistName && data.trackName ? `${data.artistName} — ${data.trackName}` : null,
    cachedAt: Date.now(),
  };
}

function hasLyrics(data) {
  return Boolean(data && (data.plainLyrics || data.syncedLyrics || data.instrumental));
}

function instrumentalEntry(source) {
  return { ok: true, lyrics: "(Instrumental — no lyrics)", synced: null, instrumental: true, source, cachedAt: Date.now() };
}

// How long to wait before the one retry a 503 gets. See lrclibFetch.
const LRCLIB_OVERLOAD_RETRY_MS = 1500;

// Minimum gap between two LRCLIB requests, app-wide. The cascade can ask
// it up to a dozen questions about a single stubborn track, and the
// background sweep asks about a whole library — fired back to back, that
// earns a 429 (confirmed against the live service), and a rate limit
// costs far more lookups than the pacing does. Measured from request
// start, like the MusicBrainz limiter this mirrors.
const LRCLIB_MIN_INTERVAL_MS = 400;

let lrclibQueueTail = Promise.resolve();
let lrclibLastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Serialises every LRCLIB request through one promise chain, so
// concurrent callers queue instead of racing. A failure doesn't break the
// chain — the .catch keeps the tail resolvable so one bad request can't
// wedge the limiter for the session.
function scheduleLrclib(task) {
  const run = lrclibQueueTail.then(async () => {
    const waitFor = lrclibLastRequestAt + LRCLIB_MIN_INTERVAL_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    lrclibLastRequestAt = Date.now();
    return task();
  });
  lrclibQueueTail = run.catch(() => {});
  return run;
}

// LRCLIB — free, open-source, and the only one of these that returns real
// time-synced lyrics, which is what the karaoke highlight runs on.
//
// Its 503 is not an outage. Measured against the live service while
// building this: a burst of requests gets back
// {"name":"ServerOverloaded","message":"The server is busy, please retry
// in a moment"}, and the identical request succeeds a second later. The
// first version of this treated any 5xx as a hard network failure, which
// meant a momentary blip didn't just lose that one request — it set the
// cascade's "infrastructure problem" flag and so skipped the remaining
// sources for that track. Hence one patient retry, and 503 kept distinct
// from 429 (a real rate limit, which no amount of immediate retrying
// fixes and which the sweep backs right off for).
//
// Returns { res } or { failure }; never throws. fetch() only rejects on a
// genuine transport-level problem — DNS, TLS, connection refused, request
// blocked — since an HTTP error status resolves normally, so the catch
// really does mean the request never completed.
async function lrclibFetch(url, { retryOnOverload = true } = {}) {
  try {
    const res = await scheduleLrclib(() => fetch(url));
    if (res.status === 429) return { failure: LYRICS_FAILURE.RATE_LIMITED };
    if (res.status === 503 && retryOnOverload) {
      await sleep(LRCLIB_OVERLOAD_RETRY_MS);
      return lrclibFetch(url, { retryOnOverload: false });
    }
    if (res.status >= 500) return { failure: LYRICS_FAILURE.NETWORK };
    return { res };
  } catch {
    return { failure: LYRICS_FAILURE.NETWORK };
  }
}

async function tryLrclibExact(artist, title) {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
  const { res, failure } = await lrclibFetch(url);
  if (failure) return { ok: false, failure };
  // A 404 here is LRCLIB's normal "no such track" — expected, and worth
  // following with the fuzzy search.
  if (!res.ok) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

  try {
    const data = await res.json();
    if (!hasLyrics(data)) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };
    if (!data.plainLyrics && !data.syncedLyrics) return instrumentalEntry("LRCLIB");
    return entryFromLrclib(data);
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}

// The fuzzy half. The original code took the first row with any lyrics in
// it, which is how a search for a short title ends up showing the lyrics
// of a different song with confidence. Rows are scored against what we
// asked for and the best one only wins if it clears FUZZY_MATCH_FLOOR.
async function tryLrclibSearch(artist, title) {
  try {
    const params = new URLSearchParams();
    if (artist) params.set("artist_name", artist);
    params.set("track_name", title);
    const structured = await lrclibFetch(`https://lrclib.net/api/search?${params}`);
    if (structured.failure) return { ok: false, failure: structured.failure };

    let rows = structured.res.ok ? await structured.res.json() : [];

    // LRCLIB also takes a single free-text q=, which matches differently
    // from the structured fields and finds things they miss (it searches
    // the album and the combined credit line too).
    if (!Array.isArray(rows) || rows.length === 0) {
      const q = [artist, title].filter(Boolean).join(" ");
      const free = await lrclibFetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (free.failure) return { ok: false, failure: free.failure };
      rows = free.res.ok ? await free.res.json() : [];
    }
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    let best = null;
    let bestScore = 0;
    for (const row of rows) {
      if (!hasLyrics(row)) continue;
      const titleScore = similarity(row.trackName, title);
      // An artist we were never sure of shouldn't be able to veto a
      // strong title match — but it shouldn't be able to carry one
      // either, so a missing artist scores below neutral and a row has to
      // earn the match on its title alone.
      const artistScore = artist ? similarity(row.artistName, artist) : 0.35;
      const score = titleScore * 0.7 + artistScore * 0.3;
      // Synced lyrics are worth a nudge between otherwise equal rows.
      const adjusted = row.syncedLyrics ? score + 0.03 : score;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = row;
      }
    }
    if (!best || bestScore < FUZZY_MATCH_FLOOR) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };
    if (!best.plainLyrics && !best.syncedLyrics) return instrumentalEntry("LRCLIB");
    return entryFromLrclib(best, { fuzzy: true });
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}

// Smaller catalog than LRCLIB and plain text only, but it sometimes has
// things LRCLIB doesn't.
async function tryLyricsOvh(artist, title) {
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (res.status === 429) return { ok: false, failure: LYRICS_FAILURE.RATE_LIMITED };
    if (res.status >= 500) return { ok: false, failure: LYRICS_FAILURE.NETWORK };
    if (!res.ok) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    const data = await res.json();
    if (!data.lyrics || !data.lyrics.trim()) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    return { ok: true, lyrics: data.lyrics.trim(), synced: null, source: "lyrics.ovh", cachedAt: Date.now() };
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}

function stripLrcTimestamps(lrc) {
  return (lrc || "")
    .split("\n")
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim())
    .join("\n");
}

// --- Time-synced lyrics ----------------------------------------------

// Parses an LRC payload into [{ time, text }], sorted, with the format's
// metadata tags ([ar:], [by:], [offset:]) dropped and multi-timestamp
// lines ("[00:12.00][01:40.00]same hook") expanded into one entry each,
// which is how an LRC file expresses a repeated chorus.
export function parseSyncedLyrics(lrc) {
  if (!lrc) return [];
  const stamp = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const out = [];
  for (const rawLine of lrc.split("\n")) {
    const times = [];
    let match;
    stamp.lastIndex = 0;
    while ((match = stamp.exec(rawLine)) !== null) {
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      times.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
    }
    if (times.length === 0) continue;
    const text = rawLine.replace(stamp, "").trim();
    for (const time of times) out.push({ time, text });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// Saved to the manual store, never the sourced-lyrics cache.
export async function saveManualLyrics(track, lyricsText) {
  const lyrics = lyricsText.trim();
  await saveManualLyricsRecord(track.id, lyrics);
  return { ok: true, lyrics, synced: null, source: "manual" };
}

// Optional bring-your-own-key fallback. Key is stored only in the user's
// browser (localStorage) and used directly from the client — never sent
// anywhere but Google's API. Clearly labeled as AI-generated and never
// presented as official lyrics.
const GEMINI_KEY_STORAGE = "upod-gemini-api-key";

export function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}
export function setGeminiKey(key) {
  if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
}

// A model that isn't sure is asked to say so, and this is the shape it
// says it in — a refusal has to be recognisable, or "I don't know this
// song" gets stored and rendered as the lyrics.
const AI_UNSURE_MARKER = "UNSURE";

export async function fetchLyricsFromGemini(track) {
  const key = getGeminiKey();
  if (!key) return { ok: false, noKey: true };

  const prompt = `Reconstruct your best-effort approximate lyrics for the song "${track.title}" by "${track.artist}". If you do not actually know this song, reply with exactly ${AI_UNSURE_MARKER} and nothing else — do not invent lyrics. Otherwise output only the lyrics text, no commentary, no title line.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (res.status === 429) return { ok: false, failure: LYRICS_FAILURE.RATE_LIMITED };
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { ok: false, failure: LYRICS_FAILURE.NETWORK };
    if (text.toUpperCase().startsWith(AI_UNSURE_MARKER)) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    const entry = { ok: true, lyrics: text, synced: null, source: "AI-generated (Gemini) — unverified", ai: true };
    // Its own store, labelled, and never the sourced cache — see the
    // module comment for why this is persisted at all.
    await saveAiLyrics(track.id, { lyrics: entry.lyrics, source: entry.source });
    return entry;
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}
