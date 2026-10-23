// src/screens/Studio.jsx
import React, { useMemo, useRef, useState } from "react";
import { Wand2, Music2, Check, Search, X, Play, ChevronDown } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { STUDIO_EFFECTS } from "../audio/studioEffects";

// How many tracks the picker lists before it insists on a search term.
// A library of several hundred rendered as one list is a scroll nobody
// finishes; the search field above it is the real way in.
const PICKER_LIMIT = 40;

function TrackPicker({ tracks, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q))
      : tracks;
    return pool.slice(0, PICKER_LIMIT);
  }, [tracks, query]);

  const selected = tracks.find((t) => t.id === value);

  if (!open) {
    return (
      <button
        className="studio-source"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        {selected ? (
          <>
            <span
              className={`studio-source-art ${selected.cover ? "" : "cover-glass"}`}
              style={selected.cover ? { background: `url(${selected.cover}) center/cover` } : undefined}
            />
            <span className="studio-source-meta">
              <span className="studio-source-title">{selected.title}</span>
              <span className="studio-source-sub">{selected.artist}</span>
            </span>
          </>
        ) : (
          <>
            <span className="studio-source-art cover-glass" />
            <span className="studio-source-meta">
              <span className="studio-source-title studio-source-empty">Choose a track…</span>
              <span className="studio-source-sub">{tracks.length} in your library</span>
            </span>
          </>
        )}
        <ChevronDown size={16} className="studio-source-chevron" />
      </button>
    );
  }

  return (
    <div className="studio-picker">
      <div className="search-bar studio-picker-search">
        <Search size={15} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library…"
        />
        <button className="bare-close" onClick={() => setOpen(false)} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="studio-picker-list">
        {matches.length === 0 && <div className="empty-state">Nothing matches "{query}".</div>}
        {matches.map((t) => (
          <button
            key={t.id}
            className={`studio-picker-row ${t.id === value ? "is-selected" : ""}`}
            onClick={() => {
              onChange(t.id);
              setOpen(false);
              setQuery("");
            }}
          >
            <span
              className={`studio-source-art ${t.cover ? "" : "cover-glass"}`}
              style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}
            />
            <span className="studio-source-meta">
              <span className="studio-source-title">{t.title}</span>
              <span className="studio-source-sub">{t.artist}</span>
            </span>
            {t.id === value && <Check size={15} className="pack-check" />}
          </button>
        ))}
        {!query.trim() && tracks.length > PICKER_LIMIT && (
          <div className="studio-picker-more">
            Showing the first {PICKER_LIMIT} of {tracks.length} — search to narrow it down.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Studio({ onOpenPlaylist }) {
  const { library, studioStatus, playlists } = usePlayerState();
  const { renderStudioEffect, playTrackList } = usePlayerActions();
  const [sourceId, setSourceId] = useState("");
  const [effectId, setEffectId] = useState(STUDIO_EFFECTS[0].id);
  const [format, setFormat] = useState("mp3");
  const [lastResult, setLastResult] = useState(null);

  const sourceTracks = library.filter((t) => !t.isStudioRender);
  const sourceTrack = sourceTracks.find((t) => t.id === sourceId);
  const rendering = studioStatus && typeof studioStatus === "string";
  const errored = studioStatus && studioStatus.error;
  const effect = STUDIO_EFFECTS.find((e) => e.id === effectId);

  // Only the playlists Studio itself created. The heading has always said
  // "Your effect playlists" while the list underneath rendered every
  // playlist in the app, Favourite Tunes included — which made it look
  // like favouriting a song had something to do with Studio.
  const effectPlaylists = playlists.filter((p) => p.effectId);

  async function handleRender() {
    if (!sourceTrack) return;
    setLastResult(null);
    const result = await renderStudioEffect(sourceTrack, effectId, format);
    if (result.ok) setLastResult({ effectId, track: result.track });
  }

  if (sourceTracks.length === 0) {
    return (
      <div className="lib-screen">
        <div className="empty-state">Load your music folder in Library first.</div>
      </div>
    );
  }

  return (
    <div className="lib-screen studio-screen">
      <div className="settings-group-title" style={{ marginTop: 4 }}>1. Pick a song from your library</div>
      <TrackPicker tracks={sourceTracks} value={sourceId} onChange={setSourceId} />

      <div className="settings-group-title">2. Pick an effect</div>
      {/* Two columns of compact cards rather than nine full-width rows:
          the old list pushed the Render button three screens down, so the
          action you came here for was never on screen with the choices
          you came here to make. */}
      <div className="studio-effect-grid">
        {STUDIO_EFFECTS.map((e) => (
          <button
            key={e.id}
            className={`studio-effect ${effectId === e.id ? "is-active" : ""}`}
            onClick={() => setEffectId(e.id)}
          >
            <span className="studio-effect-name">
              {e.label}
              {effectId === e.id && <Check size={14} className="pack-check" />}
            </span>
            <span className="studio-effect-desc">{e.desc}</span>
          </button>
        ))}
      </div>

      <div className="settings-group-title">3. Output format</div>
      <div className="theme-switch" style={{ width: "fit-content" }}>
        <button className={format === "mp3" ? "active" : ""} onClick={() => setFormat("mp3")}>MP3</button>
        <button className={format === "wav" ? "active" : ""} onClick={() => setFormat("wav")}>WAV</button>
      </div>
      <div className="settings-row-sub" style={{ marginTop: 6 }}>
        {format === "mp3"
          ? "Smaller file, encoded on the device — takes a little longer to render."
          : "Lossless and quick to write, but several times the size of the MP3."}
      </div>

      {/* The action and everything it needs to say live together at the
          bottom of the flow, in one block, instead of a bare button with
          its status spread across three other elements. */}
      <div className="studio-action">
        <button className="primary-btn studio-render" disabled={!sourceTrack || rendering} onClick={handleRender}>
          <Wand2 size={15} />
          {rendering ? "Rendering…" : sourceTrack ? `Render ${effect.label}` : "Pick a track first"}
        </button>

        {rendering && (
          <div className="studio-progress">
            <div className="studio-progress-bar"><span /></div>
            <div className="settings-row-sub">{studioStatus}</div>
          </div>
        )}

        {errored && (
          <div className="studio-error">Something went wrong: {studioStatus.error}</div>
        )}

        {!rendering && !errored && (
          <div className="settings-row-sub">
            Your original file is never touched — this renders a brand-new {format.toUpperCase()} and files
            it into a playlist named after the effect.
          </div>
        )}
      </div>

      {lastResult && (
        <div className="studio-result">
          <div className="studio-result-title">
            <Music2 size={14} /> Rendered "{lastResult.track.title}"
          </div>
          <div className="np-actions">
            <button className="pill-btn" onClick={() => playTrackList([lastResult.track])}>
              <Play size={13} /> Play it
            </button>
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
        </div>
      )}

      <div className="settings-group-title">Your effect playlists</div>
      {effectPlaylists.length === 0 && <div className="empty-state">Nothing rendered yet.</div>}
      <div className="playlist-list">
        {effectPlaylists.map((p) => (
          <button key={p.id} className="playlist-row" onClick={() => onOpenPlaylist(p)}>
            <div className="playlist-thumb studio-playlist-thumb">
              <Wand2 size={16} color="#fff" />
            </div>
            <div className="playlist-row-meta">
              <div className="playlist-row-name">{p.name}</div>
              <div className="playlist-row-count">
                {p.trackIds.length} {p.trackIds.length === 1 ? "track" : "tracks"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
