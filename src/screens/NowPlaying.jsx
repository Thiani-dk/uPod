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
  // The secondary actions that float out of the ellipsis. Collapsed by
  // default; see .np-overflow-* in global.css for why the reveal only
  // animates transform/opacity.
  const [overflowOpen, setOverflowOpen] = useState(false);
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

        <div className={`np-actions ${overflowOpen ? "np-actions-open" : ""}`}>
          {/* Closes the fan on a tap anywhere else. Rendered only while
              open and deliberately not animated — it's a hit target, not
              a visible surface. */}
          {overflowOpen && (
            <button
              className="np-overflow-scrim"
              onClick={() => setOverflowOpen(false)}
              aria-label="Close more actions"
              tabIndex={-1}
            />
          )}

          <div className="np-overflow-panel" aria-hidden={!overflowOpen}>
            {/* Stagger is applied inline rather than with nth-child rules
                so the delay follows the item's position in this list even
                if the split between primary and overflow changes. */}
            {[
              { key: "eq", icon: SlidersHorizontal, label: "Equalizer", onClick: onOpenEq },
              { key: "karaoke", icon: Mic2, label: "Karaoke", onClick: onOpenKaraoke },
              { key: "edit", icon: Pencil, label: "Edit track info", onClick: () => setEditOpen(true) },
              ...(canDelete
                ? [{ key: "delete", icon: Trash2, label: "Delete from device", onClick: () => setDeleteOpen(true), danger: true }]
                : []),
            ].map((item, i) => (
              <button
                key={item.key}
                className={`np-icon-btn np-overflow-item ${item.danger ? "np-icon-danger" : ""}`}
                style={{ transitionDelay: `${overflowOpen ? i * 35 : 0}ms` }}
                tabIndex={overflowOpen ? 0 : -1}
                onClick={() => { item.onClick(); setOverflowOpen(false); }}
                aria-label={item.label}
                title={item.label}
              >
                <item.icon size={17} />
              </button>
            ))}
            <div
              className="np-overflow-item np-overflow-speed"
              style={{ transitionDelay: `${overflowOpen ? (canDelete ? 4 : 3) * 35 : 0}ms` }}
            >
              <SpeedStepper rate={playbackRate} onChange={setPlaybackRate} />
            </div>
          </div>

          <button
            className="np-icon-btn"
            onClick={() => setAddToPlaylistOpen(true)}
            aria-label="Add to playlist"
            title="Add to playlist"
            style={isFavorite ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
          >
            <Bookmark size={17} fill={isFavorite ? "currentColor" : "none"} />
          </button>
          <button className="np-icon-btn" onClick={() => setQueueOpen(true)} aria-label="Queue" title="Queue">
            <ListMusic size={17} />
          </button>
          <button
            className={`np-icon-btn np-overflow-toggle ${overflowOpen ? "np-icon-active" : ""}`}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="More actions"
            aria-expanded={overflowOpen}
            title="More actions"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
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
