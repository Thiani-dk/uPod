// src/screens/Karaoke.jsx
import React, { useEffect, useState } from "react";
import { WifiOff, Sparkles, Save, Key } from "lucide-react";
import { usePlayerState } from "../store/PlayerContext";
import {
  fetchLyricsOnline,
  saveManualLyrics,
  fetchLyricsFromGemini,
  getGeminiKey,
  setGeminiKey,
} from "../online/lyrics";

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

  useEffect(() => {
    if (!track) return;
    setResult(null);
    setShowManual(false);
    if (!online) return;
    setLoading(true);
    fetchLyricsOnline(track.artist, track.title).then((r) => {
      setResult(r);
      setLoading(false);
    });
  }, [track?.id, online]);

  async function tryAi() {
    if (!track) return;
    setTryingAi(true);
    const r = await fetchLyricsFromGemini(track.artist, track.title);
    setResult(r);
    setTryingAi(false);
  }

  function saveKey() {
    setGeminiKey(keyDraft.trim());
    setShowKeyInput(false);
  }

  function saveManual() {
    if (!track || !manualDraft.trim()) return;
    const entry = saveManualLyrics(track.artist, track.title, manualDraft);
    setResult(entry);
    setShowManual(false);
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

      {!online && (
        <div className="karaoke-offline">
          <WifiOff size={22} />
          <div className="karaoke-offline-title">Karaoke mode needs a connection</div>
          <div className="karaoke-offline-sub">
            Lyrics are looked up online and cached locally the first time — once cached, they'll show up here even offline.
          </div>
        </div>
      )}

      {online && loading && <div className="karaoke-loading">Searching lyrics sources…</div>}

      {online && !loading && result?.ok && (
        <>
          <div className="karaoke-source">
            {result.fromCache ? "From your local cache" : `Found via ${result.source}`}
            {result.synced ? " · time-synced lyrics available" : ""} · unverified, community-sourced
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

      {online && !loading && !result?.ok && !showManual && (
        <div className="karaoke-offline">
          <div className="karaoke-offline-title">No lyrics found automatically</div>
          <div className="karaoke-offline-sub">
            {result?.notFound ? "Nothing matched this artist/title on the free lyrics database." : "The lookup failed — you can try again, paste lyrics yourself, or try an AI reconstruction."}
          </div>
          <div className="np-actions" style={{ marginTop: 14 }}>
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
