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
import { readAudioFormat, formatLabel } from "../utils/audioFormat";
import { pushBackHandler } from "../utils/backHandlerStack";

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

// How long to wait after the most recent tap on the cover art before
// deciding what the gesture was. It has to outlast the gap a person
// leaves between taps of the same burst, or a double-tap would commit and
// toggle immersive mode while the third tap of an intended triple-tap was
// still on its way. Android's own ViewConfiguration.getDoubleTapTimeout()
// is 300ms; this sits just inside it.
const TAP_COMMIT_MS = 280;

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
// Breathing room kept between the fan's far edge and the edge of the safe
// viewport, so "it fits" never means "it fits flush against the bezel".
const FAN_EDGE_GAP = 8;
// Ceiling on how far the control column may slide up to make room. Beyond
// this it would ride up over the title block entirely; past that point the
// fan compacts instead of asking for more.
const MAX_FAN_LIFT = 132;

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

function ActionFan({ canDelete, rate, onRate, onAddToPlaylist, onQueue, onEq, onKaraoke, onEdit, onDelete, onLiftChange }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(ANIM_MIN_MS);
  // How the fan will be laid out for THIS opening, decided from the space
  // actually available at the moment of the tap. See chooseFit().
  const [fit, setFit] = useState({ compact: false, lift: 0 });
  const pressStartRef = useRef(0);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const fanRef = useRef(null);
  const safeInsetRef = useRef(null);

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

  // Where the fan can actually go, measured rather than assumed. The
  // original code hard-assumed ~85px of empty space below the ellipsis,
  // which is true on the Now Playing screen it was designed for and is
  // NOT true in immersive mode, where the artwork spans the full screen
  // and the control column sits at the very bottom.
  //
  // Both heights are read off the real element rather than hardcoded: the
  // fan is always laid out (only ever hidden with opacity, never
  // display:none), so its natural height is measurable, and the compact
  // height is obtained by applying the class and reading it back before
  // paint. One forced reflow per tap is nothing, and it means changing the
  // fan's contents can never desynchronise these numbers from reality.
  function chooseFit() {
    const toggle = toggleRef.current;
    const fan = fanRef.current;
    if (!toggle || !fan) return { compact: false, lift: 0 };

    const natural = fan.offsetHeight;
    fan.classList.add("np-fan-compact");
    const compact = fan.offsetHeight;
    fan.classList.remove("np-fan-compact");

    const rect = toggle.getBoundingClientRect();
    // env(safe-area-inset-bottom) isn't readable from JS, so a zero-width
    // probe pinned to the bottom edge is sized by it in CSS and its height
    // read back here. That keeps the gesture bar out of the usable space
    // instead of the fan opening underneath it.
    const safeBottom = safeInsetRef.current ? safeInsetRef.current.offsetHeight : 0;
    const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const below = viewportH - rect.bottom - safeBottom - FAN_EDGE_GAP;

    if (below >= natural) return { compact: false, lift: 0 };
    if (below >= compact) return { compact: true, lift: 0 };

    // Not enough room even compacted. The fan still opens DOWNWARD; what
    // moves is the control column, which slides up by the shortfall and
    // takes the ellipsis with it, opening up exactly that much space
    // underneath.
    //
    // It deliberately does NOT expand upward. Upward was tried and is the
    // wrong answer here: the space above the ellipsis is the transport
    // row, and covering it — even with a card that makes the overlap look
    // deliberate — leaves the user unable to pause. Displacing the
    // transport keeps it on screen and hittable; covering it does not.
    const naturalLift = Math.ceil(natural - below);
    if (naturalLift <= MAX_FAN_LIFT) return { compact: false, lift: naturalLift };
    return { compact: true, lift: Math.min(MAX_FAN_LIFT, Math.ceil(compact - below)) };
  }

  // Reports the lift to whichever column owns this fan, so it can slide
  // itself (and fade the title block it slides into) out of the way.
  useEffect(() => {
    if (onLiftChange) onLiftChange(open ? fit.lift : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fit.lift]);

  useEffect(() => () => { if (onLiftChange) onLiftChange(0); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  // Outside-tap dismissal WITHOUT a blocking scrim. The previous version
  // laid a full-viewport invisible button over everything, which swallowed
  // the tap that dismissed it — so with the fan open, tapping play/pause
  // only closed the fan and the music kept going. A capture-phase listener
  // closes the fan and then lets the event continue to whatever was
  // actually pressed, so one tap on play both dismisses and pauses.
  useEffect(() => {
    if (!open) return undefined;
    function onDocPointerDown(e) {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      setOpen(false);
    }
    // Next frame, so the pointerdown that opened the fan doesn't close it.
    const frame = requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [open]);

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
    // Measured per-opening, not once at mount: the available space differs
    // between normal and immersive mode, and changes with orientation and
    // with the on-screen keyboard.
    // Recomputed on every open, and reset on close so no layout choice
    // survives past the opening it was made for — a stale `fit` is what
    // left an empty card pinned over the transport row.
    setFit(open ? { compact: false, lift: 0 } : chooseFit());
    setOpen((v) => !v);
  }

  function runAction(fn) {
    setFit({ compact: false, lift: 0 });
    setOpen(false);
    fn();
  }

  const reduced = prefersReducedMotion();
  const style = { "--fan-dur": reduced ? "0ms" : `${duration}ms` };

  return (
    <div ref={rootRef} className={`np-actions ${open ? "np-actions-open" : ""}`} style={style}>

      {/* Sized by env(safe-area-inset-bottom) in CSS purely so chooseFit()
          can read the value back. Zero-width, inert, never painted. */}
      <div ref={safeInsetRef} className="np-safe-inset-probe" aria-hidden="true" />

      <button
        ref={toggleRef}
        className={`np-fan-toggle ${open ? "np-icon-active" : ""}`}
        onPointerDown={handlePressStart}
        onClick={handlePressEnd}
        aria-label={open ? "Close actions" : "More actions"}
        aria-expanded={open}
      >
        <MoreHorizontal size={19} />
      </button>

      {/* Always unfolds DOWNWARD, at whatever size chooseFit() settled on.
          When there isn't room, the column above slides up rather than the
          fan reaching over the transport row. Absolutely positioned so the
          collapsed state costs no layout at all. */}
      <div
        ref={fanRef}
        className={`np-fan ${fit.compact ? "np-fan-compact" : ""}`}
      >
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


// How close to the end of a track the info slot stops advertising the
// file's encoding and starts advertising what's coming next. Format info
// is a fact about the track you're already hearing — useful at any point
// but never urgent; "what's next" only becomes interesting as the current
// track runs out, which is exactly when this hands the slot over. Tapping
// overrides the automatic choice either way, for the rest of the track.
const NEXT_UP_WINDOW_S = 20;

// The middle of the three time-row slots, in both normal and immersive
// mode. Everything it shows is read from reality: the format string comes
// from the file's own container headers (utils/audioFormat.js), the next
// track from the actual next entry in the queue.
function InfoSlot({ track, nextTrack, currentTime, duration }) {
  const [format, setFormat] = useState(null);
  // null = follow the automatic rule; "format"/"next" = user has chosen.
  const [pinned, setPinned] = useState(null);

  useEffect(() => {
    let alive = true;
    setFormat(null);
    setPinned(null);
    readAudioFormat(track).then((result) => {
      if (alive) setFormat(formatLabel(result));
    });
    return () => {
      alive = false;
    };
  }, [track]);

  const nextLabel = nextTrack
    ? `Next: ${nextTrack.title}${nextTrack.artist ? ` - ${nextTrack.artist}` : ""}`
    : null;
  const remaining = duration ? duration - currentTime : Infinity;
  const automatic = nextLabel && remaining <= NEXT_UP_WINDOW_S ? "next" : "format";
  const mode = pinned || automatic;

  // Either side can be missing — an unreadable/exotic file has no format
  // string, the last track in the queue has no next — so each falls back
  // to whichever one does exist rather than leaving the slot empty.
  const text = mode === "next" ? nextLabel || format : format || nextLabel;
  if (!text) return null;

  const canToggle = Boolean(format && nextLabel);
  return (
    <button
      className={`np-info-slot ${canToggle ? "" : "np-info-slot-static"}`}
      onClick={canToggle ? () => setPinned(mode === "next" ? "format" : "next") : undefined}
      title={canToggle ? "Tap to switch between file format and what's next" : text}
      tabIndex={canToggle ? 0 : -1}
    >
      {text}
    </button>
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
  // How far each mode's control column is currently slid up to make room
  // for its own action fan. Two pieces of state because the fan is
  // rendered into both trees and each column moves independently.
  const [immersiveLift, setImmersiveLift] = useState(0);
  const [normalLift, setNormalLift] = useState(0);
  const immersiveRef = useRef(null);
  const dragRef = useRef(null);
  // { count, timer } for the cover-art tap gesture, plus a flag that lets
  // a swipe veto the click it leaves behind (see handleArtTap).
  const tapRef = useRef({ count: 0, timer: 0 });
  const swipedRef = useRef(false);
  const track = queue[queueIndex];
  const nextTrack = queue[queueIndex + 1] || null;

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

  function toggleImmersive() {
    setImmersiveTransitioning(true);
    setImmersive((v) => !v);
  }

  // With the expand/collapse button gone, the gestures are the only way
  // out — so the hardware back button gets to be one too, rather than
  // falling through to screen navigation and stranding someone who
  // doesn't know about the swipe. Registered only while immersive is
  // actually open, and on the same LIFO stack every modal uses, so a
  // dialog opened on top of immersive still wins the first press.
  useEffect(() => {
    if (!immersive) return undefined;
    return pushBackHandler(() => {
      setImmersiveTransitioning(true);
      setImmersive(false);
    });
  }, [immersive]);

  useEffect(() => () => clearTimeout(tapRef.current.timer), []);

  // Tap-count gesture on the cover art, shared by both modes — one
  // counter, so the double-tap that leaves immersive is the same code
  // path as the one that enters it.
  //
  // The count is committed on a timer rather than acted on per tap:
  // firing the double-tap the instant the second tap lands would toggle
  // the mode out from under a third tap that was about to make it a
  // triple. Every tap restarts the window, and only what the burst
  // totalled gets acted on.
  function handleArtTap() {
    // A swipe-to-dismiss drag ends with a click on whatever was under the
    // finger. That click is not a tap, and counting it would leave a
    // phantom in the burst for the next real gesture.
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    const tap = tapRef.current;
    tap.count += 1;
    clearTimeout(tap.timer);
    tap.timer = setTimeout(() => {
      const count = tap.count;
      tap.count = 0;
      // Single tap is deliberately nothing: it used to open the album,
      // which is what triple-tap does now, and leaving it bound would
      // make every double- and triple-tap navigate away mid-burst.
      if (count === 2) toggleImmersive();
      else if (count >= 3) onOpenAlbum();
    }, TAP_COMMIT_MS);
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
      swipedRef.current = true;
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

  // Everything below the artwork is deliberately mode-independent: the
  // same markup, the same classes, the same colours in normal and
  // immersive. Only the art framing and where the title/artist sit change
  // between the two, so these are built once and rendered into both.
  // `focusable` is the sole difference — the immersive tree stays mounted
  // while closed (that's what lets it animate on transform/opacity alone),
  // and a mounted-but-hidden control must not be reachable by Tab.
  const playingFrom = (
    <div className="np-playing-from">
      <span className="np-playing-from-label">Playing from</span>
      <span className="np-playing-from-name">{track.album || track.artist}</span>
    </div>
  );

  const progressBar = (focusable) => (
    <div className="np-progress">
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
          accentColor: "var(--accent)",
          "--seek-pct": `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
        }}
        tabIndex={focusable ? 0 : -1}
      />
      <div className="np-time-row">
        <span className="np-time-end">{formatDur(currentTime)}</span>
        <InfoSlot track={track} nextTrack={nextTrack} currentTime={currentTime} duration={duration} />
        <span className="np-time-end np-time-end-right">{formatDur(duration)}</span>
      </div>
    </div>
  );

  const transportRow = (
    <div className="np-transport-row">
      <TransportButtons />
    </div>
  );

  // Position within whatever is actually loaded — an album, a playlist,
  // search results, the random mix. No special-casing per source: the
  // queue is the queue.
  const queuePosition = queue.length > 0 && (
    <div className="np-queue-pos">
      {queueIndex + 1}/{queue.length}
    </div>
  );

  // One per mode rather than one shared element: each instance reports its
  // own lift to its own column. Everything else about them is identical.
  const actionFan = (onLiftChange) => (
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
      onLiftChange={onLiftChange}
    />
  );

  const gradient = track.cover ? `url(${track.cover}) center/cover` : undefined;

  // Immersive mode. The art fills the full screen width with no border or
  // margin, in a container that is taller than the square source image, so
  // `object-fit: cover` crops it at the sides and it reads as zoomed into
  // the artwork rather than as the whole square shrunk to fit. The file
  // itself is never touched — same non-destructive rule as everywhere else
  // cover art is handled.
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

      {/* The artwork IS the screen — absolutely positioned across the
          whole view, with everything else floating on top of it. This is
          the structural difference between immersive and normal mode:
          normal mode has art in a box with controls on a separate surface
          below, and no amount of enlarging that box makes it feel like a
          different mode. */}
      <div
        className="np-immersive-art"
        onClick={handleArtTap}
        role="button"
        aria-label="Cover art — double-tap to leave immersive view, triple-tap to open the album"
      >
        {track.cover ? (
          <img className="np-immersive-art-img" src={track.cover} alt="" />
        ) : (
          <div className="np-immersive-art-fallback cover-glass">
            <NoteMark size={120} style={{ color: "var(--accent)" }} />
          </div>
        )}
        {/* The accent wash. Painted once, never animated. */}
        <div className="np-immersive-art-tint" />
      </div>

      {/* Floats on the art. Nothing in here draws a surface of its own —
          contrast comes from the tint above having already darkened the
          whole image, not from a plate behind each piece of text. */}
      <div className="np-immersive-layer">
        <div className="np-immersive-head">{playingFrom}</div>

        <div className={`np-immersive-meta ${immersiveLift ? "np-meta-receded" : ""}`}>
          <button
            className="np-artist np-immersive-artist"
            onClick={(e) => {
              e.stopPropagation();
              searchArtistOnGoogle();
            }}
            title="Search this artist on Google"
            tabIndex={immersive ? 0 : -1}
          >
            {track.artist}
          </button>
          <div className="np-title np-immersive-title">{track.title}</div>
        </div>

        {/* Slides up — transform only — when its fan needs room below the
            ellipsis. The transport row travels WITH it, so it is never
            covered and never stops being hittable. */}
        <div
          className="np-immersive-controls"
          style={immersiveLift ? { transform: `translateY(-${immersiveLift}px)` } : undefined}
        >
          {progressBar(immersive)}
          {transportRow}
          {queuePosition}
          {actionFan(setImmersiveLift)}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {immersiveView}
      <div
        className="np-screen"
        style={normalLift ? { transform: `translateY(-${normalLift}px)` } : undefined}
      >
        {queueToast && <div className="shuffle-toast">{queueToast}</div>}

        {playingFrom}

        <div
          className={`np-art ${track.cover ? "" : "cover-glass"}`}
          style={gradient ? { background: gradient } : undefined}
          onClick={handleArtTap}
          role="button"
          aria-label="Cover art — double-tap for immersive view, triple-tap to open the album"
        >
          {!track.cover && (
            <NoteMark size={120} style={{ color: "var(--accent)" }} />
          )}
        </div>

        <div className="np-meta">
          <button className="np-artist" onClick={searchArtistOnGoogle} title="Search this artist on Google">
            {track.artist}
          </button>
          <div className="np-title">{track.title}</div>
        </div>

        {progressBar(true)}

        {transportRow}

        {queuePosition}

        {actionFan(setNormalLift)}
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
