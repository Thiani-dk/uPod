// src/screens/NowPlaying.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ListMusic,
  MoreHorizontal,
  SlidersHorizontal,
  Mic2,
  MessageSquare,
  Music,
  Maximize2,
  Minimize2,
  Moon,
} from "lucide-react";
import { usePlayerState, usePlayerTime, usePlayerActions, FAVORITES_PLAYLIST_ID, SPEED_STEPS } from "../store/PlayerContext";
import TransportButtons from "../components/TransportButtons";
import QueueModal from "../components/QueueModal";
import NoteMark from "../components/NoteMark";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import SleepTimerModal from "../components/SleepTimerModal";

function formatDur(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SpeedStepper({ rate, onChange, light }) {
  return (
    <div className={`speed-stepper ${light ? "speed-stepper-light" : ""}`}>
      {SPEED_STEPS.map((s) => (
        <button
          key={s}
          className={`speed-step ${rate === s ? "speed-step-active" : ""}`}
          onClick={() => onChange(s)}
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

export default function NowPlaying({ onOpenAlbum, onOpenEq, onOpenKaraoke }) {
  const { queue, queueIndex, playlists, queueToast, playbackRate, sleepTimerEndsAt } = usePlayerState();
  const { currentTime, duration } = usePlayerTime();
  const { seek, setPlaybackRate } = usePlayerActions();
  const [queueOpen, setQueueOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [immersiveTransitioning, setImmersiveTransitioning] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const immersiveRef = useRef(null);
  const dragRef = useRef(null);
  const track = queue[queueIndex];

  // will-change is only useful for the duration of an actual transition —
  // this is the fallback that strips it back off. The common case (a real
  // CSS transition) clears it earlier via onTransitionEnd below; this
  // timeout only matters when no transition ran at all, e.g. with
  // prefers-reduced-motion set, where transitionend never fires.
  useEffect(() => {
    if (!immersiveTransitioning) return;
    const t = setTimeout(() => setImmersiveTransitioning(false), 400);
    return () => clearTimeout(t);
  }, [immersiveTransitioning]);

  function openImmersive() {
    setImmersiveTransitioning(true);
    setImmersive(true);
  }

  function closeImmersive() {
    setImmersiveTransitioning(true);
    setImmersive(false);
  }

  function handleImmersiveTransitionEnd(e) {
    if (e.target !== immersiveRef.current) return;
    if (e.propertyName === "transform" || e.propertyName === "opacity") {
      setImmersiveTransitioning(false);
    }
  }

  // Swipe-down-to-dismiss: tracked imperatively (direct style writes, no
  // setState per move) so the drag distance drives the transform in real
  // time without a React re-render on every pointermove — that's what
  // keeps a drag gesture feeling 1:1 with the finger instead of laggy.
  function handleImmersivePointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, dy: 0, dragging: false, pointerId: e.pointerId };
  }

  function handleImmersivePointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.dragging) {
      // Ignore tiny movements (taps on buttons/pills/slider) and anything
      // more horizontal than vertical or moving upward.
      if (dy < 12 || Math.abs(dx) > Math.abs(dy)) return;
      drag.dragging = true;
      setImmersiveTransitioning(true);
      if (immersiveRef.current) {
        immersiveRef.current.style.transition = "none";
        try { e.target.setPointerCapture(drag.pointerId); } catch { /* not all targets support capture */ }
      }
    }
    const clamped = Math.max(0, dy);
    drag.dy = clamped;
    if (immersiveRef.current) {
      immersiveRef.current.style.transform = `translateY(${clamped}px)`;
      immersiveRef.current.style.opacity = String(1 - Math.min(clamped / 500, 1) * 0.5);
    }
  }

  function handleImmersivePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.dragging) return;
    if (immersiveRef.current) {
      immersiveRef.current.style.transition = "";
      immersiveRef.current.style.transform = "";
      immersiveRef.current.style.opacity = "";
    }
    if (drag.dy > 120) {
      setImmersive(false);
    }
    // Otherwise the inline overrides above are cleared and the element
    // falls back to the `.np-immersive-open` class, which CSS-transitions
    // it back to translateY(0) — a snap-back with no extra JS needed.
  }

  if (!track) {
    return (
      <div className="np-screen">
        <div className="empty-state" style={{ padding: "60px 0" }}>
          Nothing playing yet — pick an album from your Library.
        </div>
      </div>
    );
  }

  const isFavorite = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID)?.trackIds.includes(track.id);
  const sleepMinsLeft = sleepTimerEndsAt ? Math.max(1, Math.ceil((sleepTimerEndsAt - Date.now()) / 60000)) : null;

  function searchArtistOnGoogle() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(track.artist)}`, "_blank", "noopener");
  }

  const progressBar = (immersiveStyle) => (
    <div className={immersiveStyle ? "np-immersive-progress" : "np-progress"}>
      <input
        type="range"
        min={0}
        max={duration || 0}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ width: "100%", accentColor: immersiveStyle ? "#fff" : "var(--accent)" }}
        tabIndex={immersiveStyle && !immersive ? -1 : 0}
      />
      <div className={immersiveStyle ? "np-immersive-time-row" : "np-time-row"}>
        <span>{formatDur(currentTime)}</span>
        <span>{formatDur(duration)}</span>
      </div>
    </div>
  );

  const gradient = track.cover ? `url(${track.cover}) center/cover` : undefined;

  const immersiveView = (
    <div
      ref={immersiveRef}
      className={`np-immersive ${immersive ? "np-immersive-open" : ""} ${immersiveTransitioning ? "np-immersive-transitioning" : ""}`}
      onTransitionEnd={handleImmersiveTransitionEnd}
      onPointerDown={handleImmersivePointerDown}
      onPointerMove={handleImmersivePointerMove}
      onPointerUp={handleImmersivePointerUp}
      onPointerCancel={handleImmersivePointerUp}
      aria-hidden={!immersive}
    >
      {queueToast && <div className="shuffle-toast">{queueToast}</div>}
      <div className="np-immersive-art-wrap">
        {track.cover ? (
          <img className="np-immersive-art-img" src={track.cover} alt="" />
        ) : (
          <div className="np-immersive-art-fallback cover-glass">
            <NoteMark size={90} style={{ color: "var(--accent)" }} />
          </div>
        )}
        <div className="np-immersive-art-tint" />
        <div className="np-immersive-art-scrim" />
      </div>

      <div className="np-immersive-content">
        <div className="np-immersive-topbar">
          <button
            className="np-immersive-close"
            onClick={closeImmersive}
            aria-label="Exit immersive view"
            tabIndex={immersive ? 0 : -1}
          >
            <Minimize2 size={16} />
          </button>
        </div>

        <div className="np-immersive-bottom">
          <div className="np-immersive-meta">
            <button className="np-immersive-title-tap" onClick={onOpenAlbum} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} tabIndex={immersive ? 0 : -1}>
              <div className="np-immersive-title">{track.title}</div>
            </button>
            <button className="np-immersive-artist" onClick={searchArtistOnGoogle} tabIndex={immersive ? 0 : -1}>
              {track.artist} · {track.album}
            </button>
          </div>

          <div className="np-immersive-pills">
            <button className="np-pill np-pill-wide" onClick={onOpenKaraoke} tabIndex={immersive ? 0 : -1}>
              <MessageSquare size={15} />
              Lyrics
            </button>
            <button
              className="np-pill np-pill-icon-only"
              onClick={() => setAddToPlaylistOpen(true)}
              aria-label={isFavorite ? "Already in Favourite Tunes — add elsewhere too" : "Add to playlist"}
              tabIndex={immersive ? 0 : -1}
            >
              <Bookmark size={15} fill={isFavorite ? "currentColor" : "none"} color={isFavorite ? "var(--accent)" : "#fff"} />
            </button>
            <button className="np-pill np-pill-group" aria-label="Song info, more" tabIndex={immersive ? 0 : -1}>
              <Music size={15} />
              <MoreHorizontal size={15} />
            </button>
            <button
              className="np-pill np-pill-icon-only"
              onClick={() => setQueueOpen(true)}
              aria-label="Queue"
              tabIndex={immersive ? 0 : -1}
            >
              <ListMusic size={16} />
            </button>
          </div>

          {progressBar(true)}
          <SpeedStepper rate={playbackRate} onChange={setPlaybackRate} light />

          <div className="np-immersive-transport">
            <TransportButtons />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {immersiveView}
      <div className="np-screen">
        {queueToast && <div className="shuffle-toast">{queueToast}</div>}

        <div className="np-playing-from">Playing from {track.album || track.artist}</div>

        <div
          className={`np-art ${track.cover ? "" : "cover-glass"}`}
          style={gradient ? { background: gradient } : undefined}
          onClick={onOpenAlbum}
        >
          {!track.cover && (
            <NoteMark size={120} style={{ color: "var(--accent)" }} />
          )}
          <button
            className="np-art-immersive-hint"
            onClick={(e) => {
              e.stopPropagation();
              openImmersive();
            }}
            aria-label="Enter immersive view"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        <div className="np-meta">
          <button className="np-artist" onClick={searchArtistOnGoogle} title="Search this artist on Google">
            {track.artist}
          </button>
          <div className="np-title">{track.title}</div>
        </div>

        {progressBar(false)}

        <div className="np-transport-row">
          <TransportButtons />
        </div>

        <SpeedStepper rate={playbackRate} onChange={setPlaybackRate} />

        <div className="np-actions">
          <button
            className="pill-btn"
            onClick={() => setAddToPlaylistOpen(true)}
            style={isFavorite ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
          >
            <Bookmark size={15} fill={isFavorite ? "currentColor" : "none"} />
            {isFavorite ? "In Favourite Tunes" : "Add to playlist"}
          </button>
          <button className="pill-btn" onClick={() => setQueueOpen(true)}>
            <ListMusic size={15} /> Queue
          </button>
          <button className="pill-btn" onClick={onOpenEq}><SlidersHorizontal size={15} /> EQ</button>
          <button className="pill-btn" onClick={onOpenKaraoke}><Mic2 size={15} /> Karaoke</button>
          <button
            className="pill-btn"
            onClick={() => setSleepTimerOpen(true)}
            style={sleepMinsLeft ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
          >
            <Moon size={15} /> {sleepMinsLeft ? `${sleepMinsLeft}m` : "Sleep"}
          </button>
          <button className="pill-btn"><MoreHorizontal size={15} /></button>
        </div>
      </div>

      {queueOpen && <QueueModal onClose={() => setQueueOpen(false)} />}
      {addToPlaylistOpen && <AddToPlaylistModal track={track} onClose={() => setAddToPlaylistOpen(false)} />}
      {sleepTimerOpen && <SleepTimerModal onClose={() => setSleepTimerOpen(false)} />}
    </>
  );
}
