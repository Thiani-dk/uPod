// src/screens/Karaoke.jsx
import React, { useEffect, useState } from "react";
import { WifiOff, Sparkles, Save, Key, RefreshCw } from "lucide-react";
import { usePlayerState } from "../store/PlayerContext";
import {
  fetchLyricsOnline,
  saveManualLyrics,
  fetchLyricsFromGemini,
  getGeminiKey,
  setGeminiKey,
  LYRICS_FAILURE,
} from "../online/lyrics";

// Each lookup failure reads differently on purpose. A genuine no-match is
// expected behaviour for an obscure or mistagged track and shouldn't be
// dressed up as a malfunction; a network or rate-limit failure is a
// temporary condition the user can actually do something about, and
// previously both rendered the same "the lookup failed" line.
const FAILURE_COPY = {
  [LYRICS_FAILURE.NOT_FOUND]: {
    title: "No lyrics found for this track",
    sub: "Neither LRCLIB nor lyrics.ovh has this artist/title. That's normal for obscure releases — and for files whose tags don't match the real artist or song name, which you can fix from the track's Edit metadata option.",
  },
  [LYRICS_FAILURE.NETWORK]: {
    title: "Couldn't reach the lyrics service",
    sub: "The request didn't complete — the lyrics service may be down, or the connection dropped. This isn't a sign the song has no lyrics; it's worth trying again.",
  },
  [LYRICS_FAILURE.RATE_LIMITED]: {
    title: "Lyrics service is rate-limiting us",
    sub: "LRCLIB is temporarily refusing further lookups. Wait a minute or so and try again — the song may well be in there.",
  },
  [LYRICS_FAILURE.OFFLINE]: {
    title: "You're offline and this track isn't cached yet",
    sub: "Lyrics are looked up online and saved automatically the first time. Once a track's lyrics have been found, they show here even with no connection.",
  },
};

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export default function Karaoke() {
  const { queue, queueIndex } = usePlayerState();
  const track = queue[queueIndex];
  const online = useOnlineStatus();

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [tryingAi, setTryingAi] = useState(false);
  const [keyDraft, setKeyDraft] = useState(getGeminiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);

  // Runs even when offline: the lookup checks the user's own paste and the
  // IndexedDB cache of previously-sourced lyrics before it ever touches
  // the network, so a cached track still shows its lyrics with no
  // connection — which is the whole point of caching them. Only if both
  // miss does it report OFFLINE.
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setResult(null);
    setShowManual(false);
    setLoading(true);
    fetchLyricsOnline(track).then((r) => {
      if (cancelled) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, online]);

  function retry() {
    if (!track) return;
    setLoading(true);
    fetchLyricsOnline(track).then((r) => {
      setResult(r);
      setLoading(false);
    });
  }

  async function tryAi() {
    if (!track) return;
    setTryingAi(true);
    const r = await fetchLyricsFromGemini(track);
    setResult(r);
    setTryingAi(false);
  }

  function saveKey() {
    setGeminiKey(keyDraft.trim());
    setShowKeyInput(false);
  }

  async function saveManual() {
    if (!track || !manualDraft.trim()) return;
    saveManualLyrics(track, manualDraft).then((entry) => {
      setResult(entry);
      setShowManual(false);
    });
  }

  if (!track) {
    return <div className="karaoke-screen"><div className="empty-state">Nothing playing yet.</div></div>;
  }

  return (
    <div className="karaoke-screen">
      <div className="karaoke-header">
        <div className="karaoke-track-title">{track.title}</div>
        <div className="karaoke-track-sub">{track.artist} · {track.album}</div>
      </div>

      {loading && <div className="karaoke-loading">Searching lyrics sources…</div>}

      {!loading && result?.ok && (
        <>
          <div className="karaoke-source">
            {result.source === "manual"
              ? "Your saved lyrics"
              : result.fromCache
                ? `Saved offline · originally from ${result.source}`
                : `Found via ${result.source}`}
            {result.synced ? " · time-synced lyrics available" : ""}
            {result.source === "manual" || result.ai ? "" : " · unverified, community-sourced"}
          </div>
          <div className="karaoke-lyrics">
            {result.lyrics.split("\n").map((line, i) => (
              <div key={i} className={/^\[.*\]$/.test(line.trim()) ? "karaoke-section" : "karaoke-line"}>
                {line || "\u00A0"}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !result?.ok && !showManual && (
        <div className="karaoke-offline">
          {result?.failure === LYRICS_FAILURE.OFFLINE && <WifiOff size={22} />}
          <div className="karaoke-offline-title">{FAILURE_COPY[result?.failure]?.title || "No lyrics found"}</div>
          <div className="karaoke-offline-sub">
            {FAILURE_COPY[result?.failure]?.sub || "Nothing matched this track on the free lyrics databases."}
          </div>
          <div className="np-actions" style={{ marginTop: 14 }}>
            {/* A no-match won't change on a retry — the song simply isn't in
                the database — so the retry button is only offered for the
                failures that genuinely might resolve on a second attempt. */}
            {result?.failure !== LYRICS_FAILURE.NOT_FOUND && (
              <button className="pill-btn" onClick={retry}><RefreshCw size={13} /> Try again</button>
            )}
            <button className="pill-btn" onClick={() => setShowManual(true)}><Save size={13} /> Paste lyrics</button>
            <button className="pill-btn" onClick={() => (getGeminiKey() ? tryAi() : setShowKeyInput(true))}>
              <Sparkles size={13} /> {tryingAi ? "Asking AI…" : "Try AI reconstruction"}
            </button>
          </div>
        </div>
      )}

      {showManual && (
        <div style={{ marginTop: 16 }}>
          <textarea
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            placeholder="Paste the lyrics here — they'll be cached for next time…"
            rows={10}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}
          />
          <button className="primary-btn" style={{ marginTop: 10 }} onClick={saveManual}>
            <Save size={14} /> Save lyrics
          </button>
        </div>
      )}

      {showKeyInput && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)" }}>
          <div className="settings-row-label" style={{ marginBottom: 6 }}><Key size={13} /> Your Gemini API key</div>
          <div className="settings-row-sub" style={{ marginBottom: 10 }}>
            Stored only in this browser, sent only to Google's API when you tap "Try AI reconstruction". Get a free key at aistudio.google.com.
          </div>
          <input
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="AIza…"
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", marginBottom: 10 }}
          />
          <button className="primary-btn" onClick={saveKey}>Save key</button>
        </div>
      )}

      {result?.source?.startsWith("AI-generated") && (
        <div className="karaoke-fallback-note">
          These lyrics were reconstructed by an AI model, not sourced from an official database — treat them as approximate.
        </div>
      )}
    </div>
  );
}
