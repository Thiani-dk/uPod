// src/components/TransportGlyphs.jsx
// uPod's own transport glyphs, drawn here as SVG paths rather than pulled
// from an icon set. Every one is on a 24x24 grid, renders in
// currentColor, and takes the same { size } prop the rest of the app's
// icons do, so a pack can mix these with nothing else needing to know.
//
// Two stroke conventions live side by side on purpose: the solid
// transport marks (play, pause, skip, rewind) are filled shapes, because
// at 18-26px a filled triangle reads instantly and an outlined one reads
// as a chevron; shuffle and repeat are stroked, because they're
// *indicators* rather than targets and a lighter mark is what keeps them
// from competing with play.
import React from "react";

function Svg({ size = 24, children, strokeWidth }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={strokeWidth ? "none" : "currentColor"}
      stroke={strokeWidth ? "currentColor" : "none"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PlayGlyph(props) {
  // Nudged right of centre: a triangle's visual centre of mass sits left
  // of its bounding box, so a geometrically centred one looks off.
  return (
    <Svg {...props}>
      <path d="M8.2 5.1 19 12 8.2 18.9Z" />
    </Svg>
  );
}

export function PauseGlyph(props) {
  return (
    <Svg {...props}>
      <rect x="6.6" y="5" width="3.9" height="14" rx="1.3" />
      <rect x="13.5" y="5" width="3.9" height="14" rx="1.3" />
    </Svg>
  );
}

// Skip: a triangle against a bar — "go to the end of this one".
export function SkipBackGlyph(props) {
  return (
    <Svg {...props}>
      <path d="M19 5.4 9.5 12 19 18.6Z" />
      <rect x="5" y="5.2" width="2.6" height="13.6" rx="1.1" />
    </Svg>
  );
}

export function SkipForwardGlyph(props) {
  return (
    <Svg {...props}>
      <path d="M5 5.4 14.5 12 5 18.6Z" />
      <rect x="16.4" y="5.2" width="2.6" height="13.6" rx="1.1" />
    </Svg>
  );
}

// Rewind/fast-forward: the tape-deck double triangle, no bar.
export function RewindGlyph(props) {
  return (
    <Svg {...props}>
      <path d="M11.6 6 3.4 12 11.6 18Z" />
      <path d="M20.6 6 12.4 12 20.6 18Z" />
    </Svg>
  );
}

export function FastForwardGlyph(props) {
  return (
    <Svg {...props}>
      <path d="M3.4 6 11.6 12 3.4 18Z" />
      <path d="M12.4 6 20.6 12 12.4 18Z" />
    </Svg>
  );
}

export function ChevronBackGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={2.1}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Svg>
  );
}

export function ChevronForwardGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={2.1}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Svg>
  );
}

export function DoubleChevronBackGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={1.9}>
      <path d="M12.6 6.2 6.8 12l5.8 5.8" />
      <path d="M19 6.2 13.2 12 19 17.8" />
    </Svg>
  );
}

export function DoubleChevronForwardGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={1.9}>
      <path d="M11.4 6.2 17.2 12l-5.8 5.8" />
      <path d="M5 6.2 10.8 12 5 17.8" />
    </Svg>
  );
}

// Shuffle: two paths that cross, each ending in an arrowhead, with the
// near path broken so the crossing reads as one going over the other.
export function ShuffleGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={1.8}>
      <path d="M3 7h3.6c1.5 0 2.4.8 3.3 2" />
      <path d="M14.2 15.1c.9 1.1 1.8 1.9 3.2 1.9H21" />
      <path d="M3 17h3.6c3 0 3.9-3.3 6.1-6.3.9-1.2 1.9-1.7 3.3-1.7H21" />
      <path d="M18.4 4.6 21 7l-2.6 2.4" />
      <path d="M18.4 14.6 21 17l-2.6 2.4" />
    </Svg>
  );
}

// Repeat: a rounded rectangle loop broken at one corner for the arrowhead.
export function RepeatGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={1.8}>
      <path d="M6.6 7.6h8.6a3 3 0 0 1 3 3v1.6" />
      <path d="M17.4 16.4H8.8a3 3 0 0 1-3-3v-1.6" />
      <path d="M8.9 5.1 6.4 7.6l2.5 2.5" />
      <path d="M15.1 18.9l2.5-2.5-2.5-2.5" />
    </Svg>
  );
}

// Repeat-one: the same loop with a numeral 1 sitting inside it.
export function RepeatOneGlyph({ size = 24 }) {
  return (
    <Svg size={size} strokeWidth={1.8}>
      <path d="M6.6 7.6h8.6a3 3 0 0 1 3 3v1.6" />
      <path d="M17.4 16.4H8.8a3 3 0 0 1-3-3v-1.6" />
      <path d="M8.9 5.1 6.4 7.6l2.5 2.5" />
      <path d="M15.1 18.9l2.5-2.5-2.5-2.5" />
      <path d="M11 11.1l1.3-.9V14" />
    </Svg>
  );
}
