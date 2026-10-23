// src/download/spotify.js
// Spotify links can't be downloaded from Spotify. Every track it serves
// is DRM-encrypted, and yt-dlp has no Spotify extractor at all — the
// request to add one was closed as not-planned on exactly those grounds.
//
// So this does what spotDL does, which is the only honest route: use the
// Spotify link purely as *metadata* (track, artist, duration, cover),
// then find that same recording on YouTube and take the audio from
// there. The consequence worth being clear about is that the result is a
// different file from a different source that should be the same
// recording — which is why the duration gate in scoreCandidate() is a
// hard reject rather than a nudge, and why the UI shows what it matched.
import { CapacitorHttp } from "@capacitor/core";

// Covers the plain link, the localised /intl-xx/ variant Spotify hands
// out in some regions, and the spotify:track:ID URI form.
const TRACK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/|spotify:track:)([A-Za-z0-9]{10,})/;
// Shortlinks don't carry the id, so they have to be followed first.
const SHORTLINK_RE = /^https?:\/\/spotify\.link\//;

export function isSpotifyUrl(url) {
  return /(?:open\.spotify\.com|spotify:|spotify\.link)/.test(url || "");
}

export function isSpotifyTrackUrl(url) {
  return TRACK_RE.test(url || "");
}

// Resolves to { title, artist, durationSec, cover } or throws with
// something a person can act on.
export async function resolveSpotifyTrack(url) {
  let target = url;

  if (SHORTLINK_RE.test(target)) {
    // CapacitorHttp follows redirects, so the final URL comes back on
    // the response and carries the real track id.
    const hop = await CapacitorHttp.get({ url: target, headers: { "User-Agent": UA } });
    target = hop?.url || target;
  }

  const match = target.match(TRACK_RE);
  if (!match) {
    throw new Error("That Spotify link isn't a single track — albums and playlists aren't supported yet.");
  }

  // The embed page is the one Spotify surface that still ships the
  // track's data in the HTML. The main /track/ page is a JS shell that
  // returns nothing useful to a non-browser client, and the old oEmbed
  // endpoint now 404s — both checked directly before settling on this.
  const res = await CapacitorHttp.get({
    url: `https://open.spotify.com/embed/track/${match[1]}`,
    headers: { "User-Agent": UA },
  });

  const html = typeof res?.data === "string" ? res.data : String(res?.data ?? "");
  const entity = extractEntity(html);
  if (!entity?.name) {
    throw new Error("Couldn't read that track's details from Spotify.");
  }

  const artists = (entity.artists || []).map((a) => a?.name).filter(Boolean);
  const images = entity.visualIdentity?.image || [];
  return {
    title: entity.name,
    artist: artists.join(", "),
    artists,
    // Spotify reports milliseconds; everything downstream wants seconds.
    durationSec: entity.duration ? Math.round(entity.duration / 1000) : null,
    cover: images.length ? images[images.length - 1]?.url : null,
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The embed page is a Next.js app, so its data sits in the __NEXT_DATA__
// script tag. Wrapped in try/catch rather than trusted, because this is
// an internal shape Spotify can change without notice — a failure here
// should surface as "couldn't read the details", not a crash.
function extractEntity(html) {
  try {
    const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    return JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity || null;
  } catch {
    return null;
  }
}

// Upload variants that are a different recording from the one on
// Spotify. Matching one of these is a strong negative unless the Spotify
// title says the same thing (a track genuinely called "... - Live").
const VARIANT_WORDS = [
  "live", "cover", "remix", "instrumental", "karaoke", "acoustic",
  "sped up", "slowed", "reverb", "nightcore", "8d", "mashup", "tribute",
];

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns a score, or null to reject outright.
export function scoreCandidate(candidate, target) {
  const duration = Number(candidate.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  // The hard gate. Two recordings of the same song that differ by more
  // than a few seconds are, in practice, not the same recording — this
  // is what keeps extended edits, live takes and hour-long loops out.
  if (target.durationSec) {
    const drift = Math.abs(duration - target.durationSec);
    if (drift > 8) return null;
  }

  let score = 0;
  if (target.durationSec) score += 20 - Math.abs(duration - target.durationSec) * 2;

  const channel = (candidate.channel || candidate.uploader || "").toLowerCase();
  const title = normalize(candidate.title);
  const wantTitle = normalize(target.title);
  const wantArtist = normalize(target.artist);

  // YouTube's auto-generated "<Artist> - Topic" channels are the
  // official audio upload: no intro, no outro, no video soundtrack
  // bed. They are the single best signal available here.
  if (channel.endsWith(" - topic")) score += 25;
  if (channel.includes("official")) score += 5;
  if (/vevo/i.test(channel)) score += 5;

  if (wantTitle && title.includes(wantTitle)) score += 20;
  if (wantArtist && (title.includes(wantArtist) || channel.includes(wantArtist))) score += 15;

  for (const word of VARIANT_WORDS) {
    const inCandidate = title.includes(word);
    const inTarget = wantTitle.includes(word);
    if (inCandidate && !inTarget) score -= 30;
  }

  return score;
}

export function pickBestMatch(candidates, target) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, target);
    if (score == null) continue;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
