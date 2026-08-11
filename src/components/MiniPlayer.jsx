// src/components/MiniPlayer.jsx
// Persistent bottom bar showing the current track, visible on every screen
// except Now Playing itself (Musicolet / iOS-style docked mini-player).
// Reuses the existing player state/actions — no playback logic of its own.
import React from "react";
import { Play, Pause } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import NoteMark from "./NoteMark";

export default function MiniPlayer({ onOpen }) {
  const { queue, queueIndex, playing } = usePlayerState();
  const { togglePlay } = usePlayerActions();
  const track = queue[queueIndex];

  if (!track) return null;

  return (
    <div className="mini-player" onClick={onOpen}>
      <div
        className={`mini-art ${track.cover ? "" : "cover-glass"}`}
        style={track.cover ? { background: `url(${track.cover}) center/cover` } : { display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {!track.cover && <NoteMark size={18} style={{ color: "var(--accent)" }} />}
      </div>
      <div className="mini-meta">
        <div className="mini-title">{track.title}</div>
        <div className="mini-artist">{track.artist}</div>
      </div>
      <button
        className="mini-play"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 1 }} />}
      </button>
    </div>
  );
}
