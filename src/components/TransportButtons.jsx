// src/components/TransportButtons.jsx
// Each pack can now change TWO things: the CSS shape/size class, AND which
// literal icon glyphs are used for shuffle/back/forward/repeat — matching
// how apps like Musicolet's "Select Style" menu work (Retro uses double
// chevrons, Stock uses rewind/fast-forward glyphs, Minimalistic uses thin
// single chevrons, etc). Color is never touched by any pack — every icon
// still inherits var(--text)/var(--text-dim)/var(--accent) from the CSS.
//
// Arrangement and hold behaviour follow ~/re-lab/specs/transport.md.
// Glyphs are uPod's own (see TransportGlyphs.jsx) rather than an icon
// set's, so the transport row is one drawn family at one optical weight.
import React, { useCallback, useEffect, useRef } from "react";
import { usePlayerState, usePlayerActions, usePlayerTime } from "../store/PlayerContext";
import { classicTick } from "../classic/haptics";
import {
  PlayGlyph, PauseGlyph,
  SkipBackGlyph, SkipForwardGlyph,
  RewindGlyph, FastForwardGlyph,
  ChevronBackGlyph, ChevronForwardGlyph,
  DoubleChevronBackGlyph, DoubleChevronForwardGlyph,
  ShuffleGlyph, RepeatGlyph, RepeatOneGlyph,
} from "./TransportGlyphs";

// Holding previous/next seeks instead of changing track. The step is a
// constant 5 seconds and it is the *interval* that accelerates — 500ms
// down to a 100ms floor in 40ms decrements. Taking the step as constant
// and speeding up the repeat gives a hold you can stop on a target: the
// position never moves further per tick than the 5s you started with, it
// just arrives more often.
const HOLD_STEP_S = 5;
const HOLD_START_MS = 500;
const HOLD_INTERVAL_STEP_MS = 40;
const HOLD_MIN_INTERVAL_MS = 100;
// How long a press has to be held before it stops being a tap. Below
// this, previous/next change track as they always have.
const HOLD_RECOGNISED_MS = 400;

const Shuffle = ShuffleGlyph;
const Repeat = RepeatGlyph;
const Repeat1 = RepeatOneGlyph;
const SkipBack = SkipBackGlyph;
const SkipForward = SkipForwardGlyph;
const ChevronLeft = ChevronBackGlyph;
const ChevronRight = ChevronForwardGlyph;
const ChevronsLeft = DoubleChevronBackGlyph;
const ChevronsRight = DoubleChevronForwardGlyph;
const Rewind = RewindGlyph;
const FastForward = FastForwardGlyph;

// Each pack: cls = CSS modifier class (shape/size), icons = which glyphs to use.
export const BUTTON_PACKS = {
  modern: {
    name: "Modern",
    desc: "Default — clean circular controls",
    cls: "tp",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  compact: {
    name: "Compact",
    desc: "Smaller, tighter spacing",
    cls: "tp tp-compact",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  bold: {
    name: "Bold",
    desc: "Larger, heavier weight",
    cls: "tp tp-bold",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  square: {
    name: "Square",
    desc: "Sharp corners, boxed side buttons",
    cls: "tp tp-square",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  mono: {
    name: "Mono Bracket",
    desc: "Retro monospace, bracketed",
    cls: "tp tp-mono",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  retro: {
    name: "Retro",
    desc: "Tape-deck double chevrons",
    cls: "tp tp-retro",
    icons: { shuffle: Shuffle, back: ChevronsLeft, forward: ChevronsRight, repeat: Repeat, repeatOne: Repeat1 },
  },
  minimal: {
    name: "Minimalistic",
    desc: "Thin single chevrons, no fill",
    cls: "tp tp-minimal",
    icons: { shuffle: Shuffle, back: ChevronLeft, forward: ChevronRight, repeat: Repeat, repeatOne: Repeat1 },
  },
  stock: {
    name: "Stock",
    desc: "Classic rewind / fast-forward glyphs",
    cls: "tp tp-stock",
    icons: { shuffle: Shuffle, back: Rewind, forward: FastForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  w10: {
    name: "W10",
    desc: "Flat outlined row, Windows-style",
    cls: "tp tp-w10",
    icons: { shuffle: Shuffle, back: SkipBack, forward: SkipForward, repeat: Repeat, repeatOne: Repeat1 },
  },
  futuristic: {
    name: "Futuristic",
    desc: "Thin double chevrons, glowing active states",
    cls: "tp tp-futuristic",
    icons: { shuffle: Shuffle, back: ChevronsLeft, forward: ChevronsRight, repeat: Repeat, repeatOne: Repeat1 },
  },
};

export default function TransportButtons() {
  const { playing, shuffle, repeatMode, buttonPack, queue, queueIndex, classicHapticStrength } = usePlayerState();
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat, seek, play } = usePlayerActions();
  const { currentTime, duration } = usePlayerTime();

  const pack = BUTTON_PACKS[buttonPack] || BUTTON_PACKS.modern;
  const { shuffle: ShuffleIcon, back: BackIcon, forward: ForwardIcon, repeat, repeatOne } = pack.icons;
  const RepeatIcon = repeatMode === "one" ? repeatOne : repeat;

  // Held in a ref so the repeating timer reads the live position without
  // the timer having to be torn down and rebuilt on every tick.
  const posRef = useRef();
  posRef.current = { currentTime, duration, hasTrack: Boolean(queue[queueIndex]) };

  const holdRef = useRef({ timer: 0, interval: HOLD_START_MS, held: false, dir: 0 });

  const stopHold = useCallback(() => {
    clearTimeout(holdRef.current.timer);
    holdRef.current.timer = 0;
  }, []);
  useEffect(() => stopHold, [stopHold]);

  function seekStep(dir) {
    const { currentTime: now, duration: total, hasTrack } = posRef.current;
    if (!hasTrack || !Number.isFinite(total) || total <= 0) return;
    seek(Math.min(Math.max(0, now + dir * HOLD_STEP_S), total));
    classicTick(classicHapticStrength);
  }

  function scheduleHold() {
    const h = holdRef.current;
    h.timer = setTimeout(() => {
      seekStep(h.dir);
      h.interval = Math.max(HOLD_MIN_INTERVAL_MS, h.interval - HOLD_INTERVAL_STEP_MS);
      scheduleHold();
    }, h.interval);
  }

  function startHold(dir) {
    const h = holdRef.current;
    h.dir = dir;
    h.held = false;
    h.interval = HOLD_START_MS;
    h.timer = setTimeout(() => {
      h.held = true;
      seekStep(dir);
      h.interval = Math.max(HOLD_MIN_INTERVAL_MS, h.interval - HOLD_INTERVAL_STEP_MS);
      scheduleHold();
    }, HOLD_RECOGNISED_MS);
  }

  // The release only changes track if the press never became a hold. A
  // held previous/next has already been answered by the seek, and firing
  // the skip on top of it would undo the thing the user just aimed at.
  function endHold(onTap) {
    stopHold();
    const wasHeld = holdRef.current.held;
    holdRef.current.held = false;
    if (!wasHeld) onTap();
  }

  function holdProps(dir, onTap) {
    return {
      onPointerDown: (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startHold(dir);
      },
      onPointerUp: () => endHold(onTap),
      onPointerLeave: () => {
        // Sliding off mid-hold ends the seek where it got to rather than
        // leaving a timer running under a finger that's gone.
        if (holdRef.current.timer || holdRef.current.held) {
          stopHold();
          holdRef.current.held = false;
        }
      },
      onPointerCancel: () => {
        stopHold();
        holdRef.current.held = false;
      },
    };
  }

  // Long-press play restarts the track: resume if paused, and go to zero.
  const playHoldRef = useRef({ timer: 0, held: false });
  function playPointerDown() {
    playHoldRef.current.held = false;
    playHoldRef.current.timer = setTimeout(() => {
      playHoldRef.current.held = true;
      seek(0);
      play();
      classicTick(classicHapticStrength);
    }, HOLD_RECOGNISED_MS + 200);
  }
  function playPointerUp() {
    clearTimeout(playHoldRef.current.timer);
    const wasHeld = playHoldRef.current.held;
    playHoldRef.current.held = false;
    if (!wasHeld) togglePlay();
  }
  useEffect(() => () => clearTimeout(playHoldRef.current.timer), []);

  return (
    <div className={pack.cls}>
      {/* Outer pair: repeat left, shuffle right, both a size down and
          dimmer than the inner three. The hierarchy is carried by glyph
          size and opacity rather than by boxes or colour. */}
      <button
        className={`tp-btn tp-side tp-outer ${repeatMode !== "off" ? "tp-active" : ""}`}
        onClick={cycleRepeat}
        aria-label={`Repeat: ${repeatMode === "off" ? "off" : repeatMode === "all" ? "all" : "one"}`}
      >
        <RepeatIcon size={18} />
      </button>
      <button className="tp-btn tp-side" aria-label="Previous (hold to rewind)" {...holdProps(-1, previous)}>
        <BackIcon size={22} />
      </button>
      <button
        className="tp-btn tp-main"
        aria-label={playing ? "Pause (hold to restart)" : "Play (hold to restart)"}
        onPointerDown={playPointerDown}
        onPointerUp={playPointerUp}
        onPointerCancel={() => clearTimeout(playHoldRef.current.timer)}
      >
        {playing ? <PauseGlyph size={26} /> : <PlayGlyph size={26} />}
      </button>
      <button className="tp-btn tp-side" aria-label="Next (hold to fast forward)" {...holdProps(1, next)}>
        <ForwardIcon size={22} />
      </button>
      <button
        className={`tp-btn tp-side tp-outer ${shuffle ? "tp-active" : ""}`}
        onClick={toggleShuffle}
        aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
      >
        <ShuffleIcon size={18} />
      </button>
    </div>
  );
}
