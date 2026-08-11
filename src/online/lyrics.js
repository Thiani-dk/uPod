// src/online/lyrics.js
// Looks up plain lyrics online (lyrics.ovh — free, CORS-enabled, no key
// needed), caches results in localStorage per artist+title, and offers an
// optional bring-your-own-key LLM fallback when nothing is found.

const CACHE_PREFIX = "upod-lyrics::";

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

function cacheKey(artist, title) {
  return `${CACHE_PREFIX}${normalize(artist)}::${normalize(title)}`;
}

export function getCachedLyrics(artist, title) {
  try {
    const raw = localStorage.getItem(cacheKey(artist, title));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(artist, title, entry) {
  try {
    localStorage.setItem(cacheKey(artist, title), JSON.stringify(entry));
  } catch {
    /* storage full or unavailable — non-fatal, just skip caching */
  }
}

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

export async function fetchLyricsOnline(artist, title) {
  const cached = getCachedLyrics(artist, title);
  if (cached) return { ...cached, fromCache: true };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, offline: true };
  }

  const cleanArtist = cleanForSearch(artist);
  const cleanTitle = cleanForSearch(title);

  // LRCLIB first — free, open-source, CORS-enabled, and returns real
  // time-synced lyrics when available (not just plain text).
  const fromLrclib = await tryLrclib(cleanArtist, cleanTitle);
  if (fromLrclib) {
    saveCache(artist, title, fromLrclib);
    return fromLrclib;
  }

  // lyrics.ovh as a fallback — smaller catalog but sometimes has things
  // LRCLIB doesn't.
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, notFound: true };
    const data = await res.json();
    if (!data.lyrics) return { ok: false, notFound: true };

    const entry = { ok: true, lyrics: data.lyrics.trim(), synced: null, source: "lyrics.ovh", cachedAt: Date.now() };
    saveCache(artist, title, entry);
    return entry;
  } catch {
    return { ok: false, error: true };
  }
}

async function tryLrclib(artist, title) {
  try {
    const directUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    let res = await fetch(directUrl);
    let data = res.ok ? await res.json() : null;

    if (!data || (!data.plainLyrics && !data.syncedLyrics)) {
      // Fall back to fuzzy search when the exact lookup misses.
      const searchUrl = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const results = await searchRes.json();
        data = Array.isArray(results) ? results.find((r) => r.plainLyrics || r.syncedLyrics) : null;
      }
    }

    if (!data || (!data.plainLyrics && !data.syncedLyrics)) return null;
    if (data.instrumental) return { ok: true, lyrics: "(Instrumental — no lyrics)", synced: null, source: "LRCLIB", cachedAt: Date.now() };

    return {
      ok: true,
      lyrics: data.plainLyrics || stripLrcTimestamps(data.syncedLyrics),
      synced: data.syncedLyrics || null,
      source: "LRCLIB",
      cachedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function stripLrcTimestamps(lrc) {
  return (lrc || "")
    .split("\n")
    .map((line) => line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim())
    .join("\n");
}

export function saveManualLyrics(artist, title, lyricsText) {
  const entry = { ok: true, lyrics: lyricsText.trim(), source: "manual", cachedAt: Date.now() };
  saveCache(artist, title, entry);
  return entry;
}

// Optional bring-your-own-key fallback. Key is stored only in the user's
// browser (localStorage) and used directly from the client — never sent
// anywhere but Google's API. Clearly labeled as AI-generated, never
// presented as official lyrics.
const GEMINI_KEY_STORAGE = "upod-gemini-api-key";

export function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}
export function setGeminiKey(key) {
  if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
}

export async function fetchLyricsFromGemini(artist, title) {
  const key = getGeminiKey();
  if (!key) return { ok: false, noKey: true };

  const prompt = `Reconstruct your best-effort approximate lyrics for the song "${title}" by "${artist}". If you are not confident, say so plainly instead of inventing lyrics. Output only the lyrics text, no commentary.`;

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
    if (!text) return { ok: false, error: true };

    const entry = { ok: true, lyrics: text.trim(), source: "AI-generated (Gemini) — unverified", cachedAt: Date.now() };
    saveCache(artist, title, entry);
    return entry;
  } catch {
    return { ok: false, error: true };
  }
}
