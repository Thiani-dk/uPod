// src/screens/NowPlaying.jsx
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
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
  Pencil,
  Trash2,
} from "lucide-react";
import { usePlayerState, usePlayerTime, usePlayerActions, FAVORITES_PLAYLIST_ID, SPEED_STEPS } from "../store/PlayerContext";
import TransportButtons from "../components/TransportButtons";
import QueueModal from "../components/QueueModal";
import NoteMark from "../components/NoteMark";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import MetadataEditModal from "../components/MetadataEditModal";
import DeleteTrackModal from "../components/DeleteTrackModal";

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

// How long a press is allowed to influence the motion. Below the floor a
// tap can't get any snappier; above the ceiling a hold can't get any more
// languid. Anything outside just clamps to the nearest end.
const PRESS_MIN_MS = 60;
const PRESS_MAX_MS = 650;
// The resulting animation duration. A flick opens the fan in 180ms; a
// deliberate half-second press takes 550ms to unfold.
const ANIM_MIN_MS = 180;
const ANIM_MAX_MS = 550;
// Each step of the ripple is a fraction of the whole animation, so the
// stagger stretches and compresses with it instead of staying fixed.
const STAGGER_DIVISOR = 11;

function pressToDuration(heldMs) {
  const clamped = Math.min(PRESS_MAX_MS, Math.max(PRESS_MIN_MS, heldMs));
  const t = (clamped - PRESS_MIN_MS) / (PRESS_MAX_MS - PRESS_MIN_MS);
  return Math.round(ANIM_MIN_MS + t * (ANIM_MAX_MS - ANIM_MIN_MS));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

// The six actions unfold downward in a single row, with the speed strip
// under them. A 3x3 grid was the earlier shape, back when the fan opened
// upward; downward there is only about 85px of genuinely empty space
// before the screen's bottom padding, which fits one row plus the strip
// but not two rows plus the strip. A single row also reads more like a
// toolbar, which is what it is.

function ActionFan({ canDelete, rate, onRate, onAddToPlaylist, onQueue, onEq, onKaraoke, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(ANIM_MIN_MS);
  const pressStartRef = useRef(0);

  // Left-to-right by how often they're reached for, with Delete last —
  // deliberately the furthest from where the thumb lands first.
  const actions = [
    { key: "playlist", icon: Bookmark, label: "Add to playlist", onClick: onAddToPlaylist },
    { key: "queue", icon: ListMusic, label: "Queue", onClick: onQueue },
    { key: "eq", icon: SlidersHorizontal, label: "Equalizer", onClick: onEq },
    { key: "karaoke", icon: Mic2, label: "Karaoke", onClick: onKaraoke },
    { key: "edit", icon: Pencil, label: "Edit track info", onClick: onEdit },
    ...(canDelete
      ? [{ key: "delete", icon: Trash2, label: "Delete from device", onClick: onDelete, danger: true }]
      : []),
  ];

  // Ripple order: nearest the ellipsis first when opening, reversed when
  // closing, so the motion always travels away from the button on the way
  // out and back toward it on the way in. The speed strip sits furthest
  // down, so it's last out and first back.
  const SPEED_SLOT = actions.length;
  function rippleIndex(domIndex) {
    return open ? domIndex : SPEED_SLOT - domIndex;
  }
  function delayFor(slot) {
    if (prefersReducedMotion()) return "0ms";
    return `${Math.round((duration / STAGGER_DIVISOR) * slot)}ms`;
  }

  function handlePressStart(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressStartRef.current = performance.now();
  }

  // The hold duration comes from pointerdown; the *toggle* is committed on
  // click. Driving the toggle from pointerup directly was tried first and
  // doesn't survive contact with this WebView: the row sits inside a
  // scrollable container, so Chromium disambiguates the touch as a
  // possible scroll and can fire pointercancel instead of pointerup —
  // confirmed on-device, where the fan simply never opened. click always
  // arrives for a real tap, and firing a frame later costs nothing,
  // because the measurement that matters was already taken on the way
  // down.
  function handlePressEnd() {
    const started = pressStartRef.current;
    pressStartRef.current = 0;
    const held = started ? performance.now() - started : PRESS_MIN_MS;
    setDuration(prefersReducedMotion() ? 0 : pressToDuration(held));
    setOpen((v) => !v);
  }

  // An outside tap has no press to measure, so it reuses whatever the last
  // deliberate press established — closing at the speed the user opened at
  // rather than snapping shut at some unrelated default.
  function collapse() {
    setOpen(false);
  }

  function runAction(fn) {
    setOpen(false);
    fn();
  }

  const reduced = prefersReducedMotion();
  const style = { "--fan-dur": reduced ? "0ms" : `${duration}ms` };

  return (
    <div className={`np-actions ${open ? "np-actions-open" : ""}`} style={style}>
      {open && (
        <button className="np-fan-scrim" onClick={collapse} aria-label="Close actions" tabIndex={-1} />
      )}

      <button
        className={`np-fan-toggle ${open ? "np-icon-active" : ""}`}
        onPointerDown={handlePressStart}
        onClick={handlePressEnd}
        aria-label={open ? "Close actions" : "More actions"}
        aria-expanded={open}
      >
        <MoreHorizontal size={19} />
      </button>

      {/* Unfolds below the ellipsis, into space that is genuinely empty —
          which is why these need no card behind them. Absolutely
          positioned so the collapsed state costs no layout at all. */}
      <div className="np-fan">
        <div className="np-fan-row">
          {actions.map((a, i) => (
            <button
              key={a.key}
              className={`np-fan-item ${a.danger ? "np-icon-danger" : ""}`}
              style={{ transitionDelay: delayFor(rippleIndex(i)) }}
              tabIndex={open ? 0 : -1}
              onClick={() => runAction(a.onClick)}
              aria-label={a.label}
              title={a.label}
            >
              <a.icon size={19} />
            </button>
          ))}
        </div>

        {/* The one exception to bare icons: a multi-value strip, not a
            single action, so it keeps the small pill it already had. */}
        <div className="np-fan-speed" style={{ transitionDelay: delayFor(open ? SPEED_SLOT : 0) }}>
          <SpeedStepper rate={rate} onChange={onRate} />
        </div>
      </div>
    </div>
  );
}

export default function NowPlaying({ onOpenAlbum, onOpenEq, onOpenKaraoke }) {
  const { queue, queueIndex, playlists, queueToast, playbackRate } = usePlayerState();
  const { currentTime, duration } = usePlayerTime();
  const { seek, setPlaybackRate, deleteTrack } = usePlayerActions();
  const [queueOpen, setQueueOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [immersiveTransitioning, setImmersiveTransitioning] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
  // Same gate TrackActionsMenu uses — only a native track has a real file
  // on disk to delete; a browser-picked or Studio-rendered one doesn't.
  const canDelete = Capacitor.isNativePlatform() && track.native;

  // Deleting what's currently playing is the one case a track row never
  // has to handle: the deleted track is the open screen's own subject.
  // deleteTrack already advances the queue, so on success there's nothing
  // to do but close the dialog and let this screen re-render on whatever
  // is playing now (or the empty state, if the queue ran out).
  async function handleDeleteCurrent() {
    const result = await deleteTrack(track);
    if (result.ok) setDeleteOpen(false);
    return result;
  }

  function searchArtistOnGoogle() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(track.artist)}`, "_blank", "noopener");
  }

  const progressBar = (immersiveStyle) => (
    <div className={immersiveStyle ? "np-immersive-progress" : "np-progress"}>
      {/* --seek-pct drives the filled portion as a gradient stop rather
          than relying on the browser's own accent-color fill: styling the
          track thin enough means taking over its appearance, which turns
          that fill off. */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: immersiveStyle ? "#fff" : "var(--accent)",
          "--seek-pct": `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
        }}
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

        <div className="np-playing-from">
          <span className="np-playing-from-label">Playing from</span>
          <span className="np-playing-from-name">{track.album || track.artist}</span>
        </div>

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

        {/* Position within whatever is actually loaded — an album, a
            playlist, search results, the random mix. No special-casing per
            source: the queue is the queue. */}
        {queue.length > 0 && (
          <div className="np-queue-pos">
            {queueIndex + 1}/{queue.length}
          </div>
        )}

        <ActionFan
          canDelete={canDelete}
          rate={playbackRate}
          onRate={setPlaybackRate}
          onAddToPlaylist={() => setAddToPlaylistOpen(true)}
          onQueue={() => setQueueOpen(true)}
          onEq={onOpenEq}
          onKaraoke={onOpenKaraoke}
          onEdit={() => setEditOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      {queueOpen && <QueueModal onClose={() => setQueueOpen(false)} />}
      {addToPlaylistOpen && <AddToPlaylistModal track={track} onClose={() => setAddToPlaylistOpen(false)} />}
      {editOpen && <MetadataEditModal track={track} onClose={() => setEditOpen(false)} />}
      {deleteOpen && (
        <DeleteTrackModal
          track={track}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDeleteCurrent}
        />
      )}
    </>
  );
}
