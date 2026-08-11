// src/components/TransportButtons.jsx
// Each pack can now change TWO things: the CSS shape/size class, AND which
// literal icon glyphs are used for shuffle/back/forward/repeat — matching
// how apps like Musicolet's "Select Style" menu work (Retro uses double
// chevrons, Stock uses rewind/fast-forward glyphs, Minimalistic uses thin
// single chevrons, etc). Color is never touched by any pack — every icon
// still inherits var(--text)/var(--text-dim)/var(--accent) from the CSS.
import React from "react";
import {
  Play, Pause,
  SkipBack, SkipForward,
  ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight,
  Rewind, FastForward,
  Shuffle,
  Repeat, Repeat1,
} from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";

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
  const { playing, shuffle, repeatMode, buttonPack } = usePlayerState();
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat } = usePlayerActions();

  const pack = BUTTON_PACKS[buttonPack] || BUTTON_PACKS.modern;
  const { shuffle: ShuffleIcon, back: BackIcon, forward: ForwardIcon, repeat, repeatOne } = pack.icons;
  const RepeatIcon = repeatMode === "one" ? repeatOne : repeat;

  return (
    <div className={pack.cls}>
      <button className={`tp-btn tp-side ${shuffle ? "tp-active" : ""}`} onClick={toggleShuffle}>
        <ShuffleIcon size={18} />
      </button>
      <button className="tp-btn tp-side" onClick={previous}>
        <BackIcon size={22} />
      </button>
      <button className="tp-btn tp-main" onClick={togglePlay}>
        {playing ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 2 }} />}
      </button>
      <button className="tp-btn tp-side" onClick={next}>
        <ForwardIcon size={22} />
      </button>
      <button className={`tp-btn tp-side ${repeatMode !== "off" ? "tp-active" : ""}`} onClick={cycleRepeat}>
        <RepeatIcon size={18} />
      </button>
    </div>
  );
}
