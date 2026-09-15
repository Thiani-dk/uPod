// src/online/lyrics.js
// Looks up lyrics online (LRCLIB first, lyrics.ovh as a fallback — both
// free, CORS-enabled, no key needed), caches genuinely-sourced results in
// IndexedDB keyed by track id so Karaoke works offline afterwards, and
// offers an optional bring-your-own-key LLM fallback when nothing is
// found.
//
// WHAT GETS CACHED, and what deliberately doesn't:
//   - lyrics from LRCLIB / lyrics.ovh  -> cached (real, sourced lyrics)
//   - AI reconstructions               -> NEVER cached. Best-guess
//     synthesis from a model is not verified lyrics, and persisting it
//     would make it indistinguishable from a real lookup on the next
//     launch. It's shown for the session and then forgotten.
//   - the user's own pasted lyrics     -> not in the lyrics cache. Kept in
//     a separate store (see libraryCache's MANUAL_LYRICS_STORE) because
//     it's the user's data rather than something retrieved — and nothing
//     else in the app stores it, so it does still need saving somewhere.
//
// Results are keyed by track id rather than artist+title so two files
// that share sloppy tags can't collide, and so a retag doesn't orphan the
// cached entry.
import {
  saveCachedLyrics,
  loadCachedLyrics,
  saveManualLyricsRecord,
  loadManualLyricsRecord,
} from "../audio/libraryCache";

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

// Every failure used to collapse into one of two shapes, so a dead
// network and a genuine "this song isn't in the database" looked the same
// on screen apart from one sentence of copy. These reasons are what the
// Karaoke screen renders distinct messages from — a real no-match is
// expected behaviour for an obscure or mistagged track and shouldn't read
// like a malfunction, while a network or rate-limit failure is worth
// offering a retry for.
export const LYRICS_FAILURE = {
  NOT_FOUND: "notFound",
  NETWORK: "network",
  RATE_LIMITED: "rateLimited",
  OFFLINE: "offline",
};

export async function fetchLyricsOnline(track) {
  if (!track) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

  // The user's own paste wins over everything — if they bothered to type
  // it in for this track, that's what they want to see.
  const manual = await loadManualLyricsRecord(track.id);
  if (manual) {
    return { ok: true, lyrics: manual.lyrics, synced: null, source: "manual", fromCache: true };
  }

  const cached = await loadCachedLyrics(track.id);
  if (cached) return { ...cached, fromCache: true };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, failure: LYRICS_FAILURE.OFFLINE };
  }

  const artist = cleanForSearch(track.artist);
  const title = cleanForSearch(track.title);
  // Nothing usable to search on (a track with no tags at all) — that's a
  // no-match, not a failure of the lookup.
  if (!artist && !title) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

  // Tracks whether any source failed for an infrastructure reason rather
  // than simply not having the song. If every source cleanly said "no
  // match", this stays null and the result is an honest NOT_FOUND.
  let infraFailure = null;

  const lrclib = await tryLrclib(artist, title);
  if (lrclib.ok) {
    await saveCachedLyrics(track.id, stripRuntimeFields(lrclib));
    return lrclib;
  }
  if (lrclib.failure !== LYRICS_FAILURE.NOT_FOUND) infraFailure = lrclib.failure;

  const ovh = await tryLyricsOvh(artist, title);
  if (ovh.ok) {
    await saveCachedLyrics(track.id, stripRuntimeFields(ovh));
    return ovh;
  }
  if (!infraFailure && ovh.failure !== LYRICS_FAILURE.NOT_FOUND) infraFailure = ovh.failure;

  return { ok: false, failure: infraFailure || LYRICS_FAILURE.NOT_FOUND };
}

// `fromCache` is a per-call display detail, not part of the stored entry.
function stripRuntimeFields({ fromCache, ...entry }) {
  return entry;
}

// LRCLIB — free, open-source, and returns real time-synced lyrics when
// available, not just plain text. It rate-limits (that's what its
// retry-after header is for), which is why 429 is called out separately
// from any other non-OK response.
async function tryLrclib(artist, title) {
  try {
    const directUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    let res = await fetch(directUrl);
    if (res.status === 429) return { ok: false, failure: LYRICS_FAILURE.RATE_LIMITED };
    // A 404 here is LRCLIB's normal "no such track" — expected, and worth
    // following with the fuzzy search below. Anything else in the 5xx
    // range is the service itself being unwell.
    if (res.status >= 500) return { ok: false, failure: LYRICS_FAILURE.NETWORK };

    let data = res.ok ? await res.json() : null;

    if (!data || (!data.plainLyrics && !data.syncedLyrics)) {
      // Fall back to fuzzy search when the exact lookup misses.
      const searchUrl = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
      const searchRes = await fetch(searchUrl);
      if (searchRes.status === 429) return { ok: false, failure: LYRICS_FAILURE.RATE_LIMITED };
      if (searchRes.status >= 500) return { ok: false, failure: LYRICS_FAILURE.NETWORK };
      if (searchRes.ok) {
        const results = await searchRes.json();
        data = Array.isArray(results) ? results.find((r) => r.plainLyrics || r.syncedLyrics) : null;
      }
    }

    if (!data || (!data.plainLyrics && !data.syncedLyrics)) {
      if (data?.instrumental) {
        return { ok: true, lyrics: "(Instrumental — no lyrics)", synced: null, source: "LRCLIB", cachedAt: Date.now() };
      }
      return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };
    }
    return {
      ok: true,
      lyrics: data.plainLyrics || stripLrcTimestamps(data.syncedLyrics),
      synced: data.syncedLyrics || null,
      source: "LRCLIB",
      cachedAt: Date.now(),
    };
  } catch {
    // fetch() only rejects on a genuine transport-level problem — DNS,
    // TLS, connection refused, request blocked. An HTTP error status
    // resolves normally and is handled above, so reaching here really
    // does mean the request never completed.
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}

// Smaller catalog than LRCLIB but sometimes has things it doesn't.
async function tryLyricsOvh(artist, title) {
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (res.status === 429) return { ok: false, failure: LYRICS_FAILURE.RATE_LIMITED };
    if (res.status >= 500) return { ok: false, failure: LYRICS_FAILURE.NETWORK };
    if (!res.ok) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    const data = await res.json();
    if (!data.lyrics) return { ok: false, failure: LYRICS_FAILURE.NOT_FOUND };

    return { ok: true, lyrics: data.lyrics.trim(), synced: null, source: "lyrics.ovh", cachedAt: Date.now() };
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}

function stripLrcTimestamps(lrc) {
  return (lrc || "")
    .split("\n")
    .map((line) => line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim())
    .join("\n");
}

// Saved to the manual store, never the sourced-lyrics cache.
export async function saveManualLyrics(track, lyricsText) {
  const lyrics = lyricsText.trim();
  await saveManualLyricsRecord(track.id, lyrics);
  return { ok: true, lyrics, synced: null, source: "manual" };
}

// Optional bring-your-own-key fallback. Key is stored only in the user's
// browser (localStorage) and used directly from the client — never sent
// anywhere but Google's API. Clearly labeled as AI-generated, never
// presented as official lyrics, and deliberately never persisted.
const GEMINI_KEY_STORAGE = "upod-gemini-api-key";

export function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}
export function setGeminiKey(key) {
  if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
}

export async function fetchLyricsFromGemini(track) {
  const key = getGeminiKey();
  if (!key) return { ok: false, noKey: true };

  const prompt = `Reconstruct your best-effort approximate lyrics for the song "${track.title}" by "${track.artist}". If you are not confident, say so plainly instead of inventing lyrics. Output only the lyrics text, no commentary.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, failure: LYRICS_FAILURE.NETWORK };

    // Intentionally NOT cached — see the module comment.
    return { ok: true, lyrics: text.trim(), synced: null, source: "AI-generated (Gemini) — unverified", ai: true };
  } catch {
    return { ok: false, failure: LYRICS_FAILURE.NETWORK };
  }
}
