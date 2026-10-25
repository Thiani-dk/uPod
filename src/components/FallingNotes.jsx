// src/components/FallingNotes.jsx
// uPod's own note mark, shaken loose by whatever is playing and falling
// from the spinning record down into the Instant Mix tile.
//
// The notes are driven by the actual signal, not by a timer pretending
// to be one: AudioEngine exposes an analyser tap (see getLevels there),
// and this watches it for the moments a listener would call a beat — a
// jump above the recent running loudness — and drops a note on each
// one. Where the energy sits in the spectrum decides what the note
// looks like: bass pushes it left, heavy and slow; treble sends it
// right, small and quick. So a sparse track produces the occasional
// note and a dense one produces a shower, which is the whole point of
// tying it to the audio rather than to a clock.
//
// It lands in the Instant Mix tile because that is what is underneath,
// and because a note dissolving into "build me a mix" is the nicest
// available reading of where the music is going.
import React, { useEffect, useRef, useState } from "react";
import NoteMark from "./NoteMark";

// Beat detection, such as it is. A frame counts as a beat when it is
// this much louder than the recent average and is not merely the
// loudest moment of near-silence.
const BEAT_RATIO = 1.28;
const MIN_LEVEL = 0.06;
// Two notes closer together than this read as one blur, and a dense
// track would otherwise emit on most frames.
const MIN_GAP_MS = 150;
// Enough to look like a stream, few enough that a loud passage can't
// turn into a wall of glyphs.
const MAX_NOTES = 9;
// How quickly the running average follows the music. Low enough to
// still be "recent loudness" a second later, high enough that a quiet
// passage doesn't keep measuring itself against a loud one.
const AVERAGE_SMOOTHING = 0.92;
// Used only when there is no analyser to read (the web build, or before
// anything has played through the graph this session) — music is
// audibly playing, so something should still be falling.
const FALLBACK_EVERY_MS = 820;

let nextId = 0;

function makeNote(levels) {
  const { level = 0.4, bass = 0.4, treble = 0.4 } = levels || {};
  // Where the energy is decides which side of the record the note
  // leaves from: lows to the left, highs to the right.
  const balance = treble - bass;
  const startX = 50 + balance * 26 + (Math.random() * 16 - 8);

  return {
    id: nextId++,
    // Percentages of the layer's width, so the fall works at any width.
    startX: Math.max(8, Math.min(92, startX)),
    // Sideways travel on the way down. Bass-heavy notes sway further,
    // like something heavy swinging; bright ones fall straighter.
    drift: (Math.random() < 0.5 ? -1 : 1) * (6 + bass * 20),
    size: Math.round(9 + bass * 9),
    // Louder moments fall faster.
    duration: 2600 - Math.min(1100, level * 1400),
    spin: Math.round((Math.random() * 2 - 1) * 40),
  };
}

export default function FallingNotes({ playing, getAudioLevels }) {
  const [notes, setNotes] = useState([]);
  const stateRef = useRef({ average: 0, lastEmit: 0 });

  // PlayerContext rebuilds its actions object on every render, so this
  // prop is a new function each time. Read through a ref rather than
  // depending on it: as a dependency it would tear down and restart the
  // frame loop on every render, which is both wasteful and subtly
  // wrong — each note's removal timer belongs to the effect run that
  // created it, so a restart would orphan every note in flight.
  const levelsRef = useRef(getAudioLevels);
  levelsRef.current = getAudioLevels;

  // Removal timers outlive their effect run (see above), so they check
  // whether the component is still here, not whether that run is.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      // Let whatever is mid-fall finish rather than snapping them out
      // of existence on pause; new ones simply stop arriving.
      return undefined;
    }

    // Motion that carries no information the user needs — the music is
    // already audible — so it is the first thing to go.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return undefined;

    let frame;
    let cancelled = false;

    const emit = (levels) => {
      const note = makeNote(levels);
      setNotes((prev) => [...prev.slice(-(MAX_NOTES - 1)), note]);
      // Self-removing: an animationend handler would be tidier, but a
      // note can also be dropped from the list by MAX_NOTES before it
      // ever finishes, and then that event never arrives.
      setTimeout(() => {
        if (mountedRef.current) setNotes((prev) => prev.filter((n) => n.id !== note.id));
      }, note.duration + 80);
    };

    const tick = () => {
      if (cancelled) return;
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      const state = stateRef.current;
      const levels = levelsRef.current?.();

      if (!levels) {
        if (now - state.lastEmit >= FALLBACK_EVERY_MS) {
          state.lastEmit = now;
          emit(null);
        }
        return;
      }

      const { level } = levels;
      state.average = state.average * AVERAGE_SMOOTHING + level * (1 - AVERAGE_SMOOTHING);

      const isBeat = level > MIN_LEVEL && level > state.average * BEAT_RATIO;
      if (isBeat && now - state.lastEmit >= MIN_GAP_MS) {
        state.lastEmit = now;
        emit(levels);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [playing]);

  if (notes.length === 0) return null;

  return (
    <div className="falling-notes" aria-hidden="true">
      {notes.map((note) => (
        <span
          key={note.id}
          className="falling-note"
          style={{
            left: `${note.startX}%`,
            "--drift": `${note.drift}px`,
            "--spin": `${note.spin}deg`,
            animationDuration: `${note.duration}ms`,
          }}
        >
          <NoteMark size={note.size} />
        </span>
      ))}
    </div>
  );
}
