// src/classic/ClickWheel.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { classicTick } from "./haptics";

// Degrees of rotation per emitted step, per sensitivity setting. "Medium"
// is 20°, i.e. 18 steps per revolution: a quarter turn is four or five
// rows, a full turn is half a screenful. Slow and fast are roughly a
// third either side of it, which is enough to feel like a different wheel
// without either becoming unusable.
export const WHEEL_STEP_DEGREES = { slow: 28, medium: 20, fast: 13 };

export const WHEEL_SENSITIVITIES = [
  { id: "slow", label: "Slow" },
  { id: "medium", label: "Medium" },
  { id: "fast", label: "Fast" },
];

// Rotation doesn't begin until the finger has swept this far. Without a
// deadband, the tiny angular drift in any real press — a thumb rolls, it
// doesn't pivot — reads as rotation and swallows the tap.
const ROTATE_START_DEG = 10;

// A press only counts as a tap if the finger stayed inside this many
// pixels. The time limit is deliberately applied only to previous/next:
// those are the two quadrants where a long press means something else
// (seek), so a press that outlived the tap window has already been
// answered by the hold and must not also fire the button. MENU and
// play/pause have no hold behaviour, so enforcing a deadline there would
// only create presses that do nothing at all — no seek, no button, no
// feedback — which is exactly how a control earns a reputation for
// missing taps.
const TAP_MAX_TRAVEL_PX = 8;
const TAP_MAX_MS = 250;

// Holding previous/next seeks. The first jump waits out HOLD_START_MS so
// an ordinary tap is never a seek. The step is a constant 5 seconds and
// it is the *interval* that accelerates — 500ms down to a 100ms floor in
// 40ms decrements. Same model as the normal UI's transport row, and from
// the same reasoning (~/re-lab/specs/transport.md §4): a constant step
// means the position never jumps further per tick than the 5s you started
// with, so a long hold stays stoppable on a target instead of flying past
// it in ever bigger leaps.
const HOLD_START_MS = 450;
const HOLD_STEP_S = 5;
const HOLD_FIRST_INTERVAL_MS = 500;
const HOLD_INTERVAL_STEP_MS = 40;
const HOLD_MIN_INTERVAL_MS = 100;

// Normalizes a raw angle difference into (-180, 180] so crossing the
// atan2 discontinuity at ±180° reads as a small step in the direction the
// finger actually moved, not a near-full revolution the other way.
function normalizeDelta(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Which compass point a press at (dx, dy) from the wheel centre belongs
// to. Each marking owns the full 90° quadrant centred on it, so there is
// no dead angle anywhere on the ring. dy is screen-space (down positive),
// so -90° is up.
function quadrantFor(dx, dy) {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= -135 && deg < -45) return "menu";
  if (deg >= -45 && deg < 45) return "next";
  if (deg >= 45 && deg < 135) return "playpause";
  return "prev";
}

/* Rotation and the four compass buttons on one surface, the way the
   original works: the ring is a single pointer target and the gesture
   decides what the press meant.

   Three outcomes, and exactly one of them happens per press:
   - swept past ROTATE_START_DEG -> rotation. Every button is off the
     table from that moment, including on release, so scrolling a long
     list can never also fire play/pause.
   - held on previous/next past HOLD_START_MS -> accelerating seek, and
     the release is swallowed.
   - lifted inside TAP_MAX_TRAVEL_PX and TAP_MAX_MS -> a tap on whichever
     quadrant it landed in.

   onStep(direction) fires once per step with +1 clockwise / -1
   counter-clockwise; onSeekBy(seconds) fires repeatedly during a hold. */
export default function ClickWheel({
  sensitivity = "medium",
  hapticStrength = "medium",
  onStep,
  onSelect,
  onMenu,
  onPrev,
  onNext,
  onPlayPause,
  onSeekBy,
}) {
  const dragRef = useRef(null);
  const holdRef = useRef({ timer: 0, interval: 0 });
  const [active, setActive] = useState(false);
  const [holding, setHolding] = useState(null);
  const [flash, setFlash] = useState(null);

  // Read inside pointer handlers that outlive the render they were
  // attached in (the hold timers especially), so a setting changed
  // mid-gesture doesn't get lost and doesn't need the gesture restarted.
  const configRef = useRef();
  configRef.current = { sensitivity, hapticStrength, onSeekBy };

  const stopHold = useCallback(() => {
    clearTimeout(holdRef.current.timer);
    // A chained setTimeout rather than a setInterval, because the gap
    // between repeats shrinks as the hold goes on.
    clearTimeout(holdRef.current.interval);
    holdRef.current = { timer: 0, interval: 0 };
    setHolding(null);
  }, []);

  useEffect(() => stopHold, [stopHold]);

  function tick() {
    classicTick(configRef.current.hapticStrength);
  }

  function startHold(zone) {
    const dir = zone === "next" ? 1 : -1;
    let interval = HOLD_FIRST_INTERVAL_MS;
    setHolding(zone);
    const fire = () => {
      configRef.current.onSeekBy?.(dir * HOLD_STEP_S);
      tick();
      interval = Math.max(HOLD_MIN_INTERVAL_MS, interval - HOLD_INTERVAL_STEP_MS);
      holdRef.current.interval = setTimeout(fire, interval);
    };
    fire();
  }

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
    const zone = quadrantFor(dx, dy);
    dragRef.current = {
      cx,
      cy,
      radius,
      zone,
      startX: e.clientX,
      startY: e.clientY,
      startAt: Date.now(),
      lastAngle: (Math.atan2(dy, dx) * 180) / Math.PI,
      sweep: 0,
      residual: 0,
      rotating: false,
      travel: 0,
      held: false,
    };
    setActive(true);
    // Keeps the drag alive if the finger leaves the ring mid-rotation
    // (easy to do on a wheel this size). Throws for a pointer id that
    // isn't actually down — which never happens from a real touch, but
    // does from a synthesized event, and losing capture is not a reason
    // to drop the gesture.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no capture; the ring still gets moves while the finger is on it */
    }
    if (zone === "prev" || zone === "next") {
      holdRef.current.timer = setTimeout(() => {
        const d = dragRef.current;
        // A hold only starts if the finger is still down and still hasn't
        // turned into a rotation.
        if (!d || d.rotating) return;
        d.held = true;
        startHold(zone);
      }, HOLD_START_MS);
    }
  }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI;
    const delta = normalizeDelta(angle - d.lastAngle);
    d.lastAngle = angle;
    d.travel = Math.max(d.travel, Math.hypot(e.clientX - d.startX, e.clientY - d.startY));

    if (!d.rotating) {
      // Signed, so a thumb that wobbles back and forth never accumulates
      // its way past the deadband — only a sweep that keeps going one way
      // becomes rotation.
      d.sweep += delta;
      if (Math.abs(d.sweep) < ROTATE_START_DEG) return;
      d.rotating = true;
      stopHold();
      d.held = false;
      // The sweep that crossed the deadband is consumed by starting the
      // rotation rather than counted towards the first step, so the first
      // step still takes a full step's worth of travel after it.
      d.residual = 0;
    }

    d.residual += delta;
    const stepDeg = WHEEL_STEP_DEGREES[configRef.current.sensitivity] || WHEEL_STEP_DEGREES.medium;
    // A single move event can span more than one step (a fast flick, or a
    // dropped frame), so drain the accumulator rather than emitting once.
    while (Math.abs(d.residual) >= stepDeg) {
      const dir = d.residual > 0 ? 1 : -1;
      d.residual -= dir * stepDeg;
      onStep?.(dir);
      tick();
    }
  }

  function handlePointerUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    setActive(false);
    stopHold();
    if (!d) return;
    // A rotation or a hold has already done what the press meant. Firing
    // a button on top of it is the bug this whole branch exists to stop.
    if (d.rotating || d.held) return;
    if (d.travel > TAP_MAX_TRAVEL_PX) return;

    const dx = e.clientX - d.cx;
    const dy = e.clientY - d.cy;
    const held = Date.now() - d.startAt > TAP_MAX_MS;
    if (held && (d.zone === "prev" || d.zone === "next")) return;
    setFlash({ x: `${((dx + d.radius) / (d.radius * 2)) * 100}%`, y: `${((dy + d.radius) / (d.radius * 2)) * 100}%` });
    setTimeout(() => setFlash(null), 110);
    tick();
    const zone = quadrantFor(dx, dy);
    if (zone === "menu") onMenu?.();
    else if (zone === "next") onNext?.();
    else if (zone === "playpause") onPlayPause?.();
    else onPrev?.();
  }

  function handlePointerCancel() {
    dragRef.current = null;
    setActive(false);
    stopHold();
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
      <div className={`cl-wheel-mark left ${holding === "prev" ? "seeking" : ""}`}>
        <SkipGlyph dir="back" />
      </div>
      <div className={`cl-wheel-mark right ${holding === "next" ? "seeking" : ""}`}>
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
          tick();
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
