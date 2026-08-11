// src/screens/Studio.jsx
import React, { useState } from "react";
import { Wand2, Music2, Check } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { STUDIO_EFFECTS } from "../audio/studioEffects";

export default function Studio({ onOpenPlaylist }) {
  const { library, studioStatus, playlists } = usePlayerState();
  const { renderStudioEffect } = usePlayerActions();
  const [sourceId, setSourceId] = useState("");
  const [effectId, setEffectId] = useState(STUDIO_EFFECTS[0].id);
  const [format, setFormat] = useState("mp3");
  const [lastResult, setLastResult] = useState(null);

  const sourceTracks = library.filter((t) => !t.isStudioRender);
  const sourceTrack = sourceTracks.find((t) => t.id === sourceId);
  const rendering = studioStatus && typeof studioStatus === "string";
  const errored = studioStatus && studioStatus.error;

  async function handleRender() {
    if (!sourceTrack) return;
    setLastResult(null);
    const result = await renderStudioEffect(sourceTrack, effectId, format);
    if (result.ok) setLastResult({ effectId, track: result.track });
  }

  return (
    <div className="lib-screen">
      <div className="settings-group-title" style={{ marginTop: 4 }}>1. Pick a song from your library</div>
      {sourceTracks.length === 0 ? (
        <div className="empty-state">Load your music folder in Library first.</div>
      ) : (
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--panel)", color: "var(--text)", fontSize: 13, marginBottom: 20,
          }}
        >
          <option value="">Choose a track…</option>
          {sourceTracks.map((t) => (
            <option key={t.id} value={t.id}>{t.title} — {t.artist}</option>
          ))}
        </select>
      )}

      <div className="settings-group-title">2. Pick an effect</div>
      <div className="pack-list" style={{ marginBottom: 20 }}>
        {STUDIO_EFFECTS.map((e) => (
          <button
            key={e.id}
            className={`pack-row ${effectId === e.id ? "pack-active" : ""}`}
            onClick={() => setEffectId(e.id)}
          >
            <div className="pack-meta">
              <div className="pack-name">{e.label}</div>
              <div className="pack-desc">{e.desc}</div>
            </div>
            {effectId === e.id && <Check size={16} className="pack-check" />}
          </button>
        ))}
      </div>

      <div className="settings-group-title">3. Output format</div>
      <div className="theme-switch" style={{ marginBottom: 20, width: "fit-content" }}>
        <button className={format === "mp3" ? "active" : ""} onClick={() => setFormat("mp3")}>MP3</button>
        <button className={format === "wav" ? "active" : ""} onClick={() => setFormat("wav")}>WAV</button>
      </div>

      <button
        className="primary-btn"
        disabled={!sourceTrack || rendering}
        onClick={handleRender}
        style={{ marginBottom: 10 }}
      >
        <Wand2 size={15} /> {rendering ? studioStatus : "Render new file"}
      </button>

      {errored && (
        <div className="settings-row-sub" style={{ color: "#e05555", marginBottom: 16 }}>
          Something went wrong: {studioStatus.error}
        </div>
      )}

      <div className="settings-row-sub" style={{ marginBottom: 24 }}>
        This never modifies your original file — it renders a brand-new {format.toUpperCase()} and
        files it into a playlist named after the effect.
      </div>

      {lastResult && (
        <div className="track-order-row" style={{ marginBottom: 24 }}>
          <span>
            <Music2 size={13} style={{ marginRight: 6 }} />
            Rendered "{lastResult.track.title}"
          </span>
          <button
            className="pill-btn"
            onClick={() => {
              const pl = playlists.find((p) => p.effectId === lastResult.effectId);
              if (pl) onOpenPlaylist(pl);
            }}
          >
            Open playlist
          </button>
        </div>
      )}

      <div className="settings-group-title">Your effect playlists</div>
      {playlists.length === 0 && <div className="empty-state">Nothing rendered yet.</div>}
      <div className="playlist-list">
        {playlists.map((p) => (
          <button key={p.id} className="playlist-row" onClick={() => onOpenPlaylist(p)}>
            <div className="playlist-thumb" style={{ background: "var(--accent)" }}>
              <Wand2 size={16} color="#fff" />
            </div>
            <div className="playlist-row-meta">
              <div className="playlist-row-name">{p.name}</div>
              <div className="playlist-row-count">{p.trackIds.length} tracks</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
