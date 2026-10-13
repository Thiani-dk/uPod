// src/classic/ClickWheel.jsx
import React, { useRef, useState } from "react";
import { classicTick } from "./haptics";

// Degrees of rotation per emitted step. 15° gives 24 steps per full
// revolution, which lands between "a flick moves one row" (too slow to
// cross a 900-track list) and "a flick overshoots the list" — a quarter
// turn is six rows, a full turn is a screenful of three.
const STEP_DEG = 15;

// A press is only read as a compass tap if the finger stayed within this
// fraction of the wheel radius. Scaling it to the radius rather than
// using a fixed px value keeps the feel identical at every --u.
const TAP_TRAVEL_FRACTION = 0.085;

// Normalizes a raw angle difference into (-180, 180] so crossing the
// atan2 discontinuity at ±180° reads as a small step in the direction the
// finger actually moved, not a near-full revolution the other way.
function normalizeDelta(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Which compass point a tap at (dx, dy) from the wheel centre belongs to.
// Each marking owns the full 90° quadrant centred on it, so there is no
// dead angle anywhere on the ring. dy is screen-space (down positive), so
// -90° is up.
function quadrantFor(dx, dy) {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= -135 && deg < -45) return "menu";
  if (deg >= -45 && deg < 45) return "next";
  if (deg >= 45 && deg < 135) return "playpause";
  return "prev";
}

/* Rotation and the four compass buttons on one surface, the way the
   original works: the ring is a single pointer target and the gesture
   decides what the press meant. A drag that produces at least one step is
   rotation and never also fires a button; a press that produces none and
   stayed put is a tap on whichever quadrant it landed in.

   onStep(direction) is called once per STEP_DEG crossed, with +1
   clockwise / -1 counter-clockwise, and is what every screen uses to move
   a selection or scrub. */
export default function ClickWheel({ onStep, onSelect, onMenu, onPrev, onNext, onPlayPause }) {
  const dragRef = useRef(null);
  const [active, setActive] = useState(false);
  const [flash, setFlash] = useState(null);

  function centreOf(el) {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
  }

  function handlePointerDown(e) {
    const { cx, cy, radius } = centreOf(e.currentTarget);
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // Presses that land on the hub never reach here (the hub stops
    // propagation), but a press outside the ring circle can, via the
    // square bounding box of a round element.
    if (Math.hypot(dx, dy) > radius) return;
    dragRef.current = {
      cx,
      cy,
      radius,
      startX: e.clientX,
      startY: e.clientY,
      lastAngle: (Math.atan2(dy, dx) * 180) / Math.PI,
      residual: 0,
      steps: 0,
      travel: 0,
    };
    setActive(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI;
    d.residual += normalizeDelta(angle - d.lastAngle);
    d.lastAngle = angle;
    d.travel = Math.max(d.travel, Math.hypot(e.clientX - d.startX, e.clientY - d.startY));
    // A single move event can span more than one step (a fast flick, or a
    // dropped frame), so drain the accumulator rather than emitting once.
    while (Math.abs(d.residual) >= STEP_DEG) {
      const dir = d.residual > 0 ? 1 : -1;
      d.residual -= dir * STEP_DEG;
      d.steps += 1;
      onStep?.(dir);
      classicTick();
    }
  }

  function handlePointerUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    setActive(false);
    if (!d) return;
    if (d.steps > 0 || d.travel > d.radius * TAP_TRAVEL_FRACTION) return;
    const dx = e.clientX - d.cx;
    const dy = e.clientY - d.cy;
    const zone = quadrantFor(dx, dy);
    setFlash({ x: `${((dx + d.radius) / (d.radius * 2)) * 100}%`, y: `${((dy + d.radius) / (d.radius * 2)) * 100}%` });
    setTimeout(() => setFlash(null), 110);
    classicTick();
    if (zone === "menu") onMenu?.();
    else if (zone === "next") onNext?.();
    else if (zone === "playpause") onPlayPause?.();
    else onPrev?.();
  }

  function handlePointerCancel() {
    dragRef.current = null;
    setActive(false);
  }

  return (
    <div
      className={`cl-wheel ${active ? "active" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      role="group"
      aria-label="Click wheel"
    >
      <div
        className={`cl-wheel-quadrant-flash ${flash ? "on" : ""}`}
        style={flash ? { "--flash-x": flash.x, "--flash-y": flash.y } : undefined}
      />
      <div className="cl-wheel-mark menu">MENU</div>
      <div className="cl-wheel-mark left">
        <SkipGlyph dir="back" />
      </div>
      <div className="cl-wheel-mark right">
        <SkipGlyph dir="forward" />
      </div>
      <div className="cl-wheel-mark bottom">
        <PlayPauseGlyph />
      </div>
      <button
        className="cl-hub"
        aria-label="Select"
        // The hub is a child of the ring, so without this a press on it
        // would also start a rotation drag and the release would be read
        // as a compass tap in whatever quadrant it sits in.
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => {
          classicTick();
          onSelect?.();
        }}
      />
    </div>
  );
}

// Both glyphs are plain SVG paths sized in wheel units — generic
// transport symbols, drawn here rather than pulled from an icon set so
// they scale with the body and match the wheel's ink colour.
function SkipGlyph({ dir }) {
  const flip = dir === "back" ? "scale(-1,1) translate(-20,0)" : undefined;
  return (
    <svg className="cl-glyph skip" viewBox="0 0 20 14" fill="currentColor" aria-hidden="true">
      <g transform={flip}>
        <path d="M1 1.2 L9 7 L1 12.8 Z" />
        <path d="M9 1.2 L17 7 L9 12.8 Z" />
        <rect x="17.6" y="1.2" width="1.8" height="11.6" rx="0.6" />
      </g>
    </svg>
  );
}

function PlayPauseGlyph() {
  return (
    <svg className="cl-glyph play" viewBox="0 0 24 14" fill="currentColor" aria-hidden="true">
      <path d="M1 1.2 L10 7 L1 12.8 Z" />
      <rect x="14" y="1.2" width="2.6" height="11.6" rx="0.7" />
      <rect x="19" y="1.2" width="2.6" height="11.6" rx="0.7" />
    </svg>
  );
}
