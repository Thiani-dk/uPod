// src/components/MiniPlayer.jsx
// Persistent bottom bar showing the current track, visible on every screen
// except Now Playing itself (Musicolet / iOS-style docked mini-player).
// Reuses the existing player state/actions — no playback logic of its own.
import React, { useRef, useState } from "react";
import { Play, Pause, X } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import NoteMark from "./NoteMark";

// How far down the bar has to be dragged before letting go dismisses it,
// and how far it's allowed to follow the finger. Both small: this is a
// 56px bar, so a dismissal gesture that demanded half a screen of travel
// would be unusable.
const DISMISS_AFTER_PX = 34;
const MAX_DRAG_PX = 70;

export default function MiniPlayer({ onOpen }) {
  const { queue, queueIndex, playing, resumePrompt, miniPlayerHidden } = usePlayerState();
  const { togglePlay, hideMiniPlayer } = usePlayerActions();
  const track = queue[queueIndex];
  const dragRef = useRef(null);
  const [dragY, setDragY] = useState(0);

  // While the resume prompt is up the bar would be answering its own
  // question — showing a track the user hasn't yet said they want. It
  // comes back (or doesn't) once they've answered.
  if (!track || resumePrompt || miniPlayerHidden) return null;

  function handlePointerDown(e) {
    // Mouse drags would fight with the click-to-open; touch/pen only.
    if (e.pointerType === "mouse") return;
    dragRef.current = { startY: e.clientY, moved: false, dy: 0 };
  }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (dy <= 0) {
      d.dy = 0;
      setDragY(0);
      return;
    }
    d.moved = true;
    // The decision at pointerup reads this, not the dragY state: a
    // pointercancel (or a release on the same frame as the last move) can
    // arrive before React has re-rendered, and a dismissal that depends on
    // a state update having landed is a dismissal that sometimes doesn't.
    d.dy = Math.min(dy, MAX_DRAG_PX);
    setDragY(d.dy);
  }

  function handlePointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && (d.dy || 0) >= DISMISS_AFTER_PX) hideMiniPlayer();
    setDragY(0);
  }

  return (
    <div
      className="mini-player"
      // A drag that dismissed the bar must not also count as a tap that
      // opens Now Playing.
      onClick={() => {
        if (dragY === 0) onOpen();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={dragY ? { transform: `translateY(${dragY}px)`, opacity: 1 - dragY / (MAX_DRAG_PX * 1.6) } : undefined}
    >
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
      {/* The discoverable half of the dismiss gesture. Dismissing only
          hides the bar — playback carries on, and anything that starts a
          track brings it back. */}
      <button
        className="mini-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          hideMiniPlayer();
        }}
        aria-label="Hide the Now Playing bar"
      >
        <X size={15} />
      </button>
    </div>
  );
}
