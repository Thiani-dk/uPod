// src/components/FallingNotes.jsx
// uPod's own note mark, shaken loose by whatever is playing and falling
// from the record down into the Instant Mix tile.
//
// The notes are driven by the actual signal, not by a timer pretending
// to be one: AudioEngine exposes an analyser tap (see getLevels there)
// and this watches its spectral flux — how much louder each band got
// since the last frame — which is what marks the *start* of a sound
// rather than its loudest moment.
//
// Detecting an onset is only half of it, though. A detector can only
// ever report a beat once it has already happened, and a note that
// starts falling then is permanently a few frames late — which is
// exactly what "not quite on tempo" looks like. So this estimates the
// tempo from the gaps between onsets and, once it is confident, stops
// reacting and starts *predicting*: notes leave the record slightly
// before each beat is due, so they are already in flight when it
// lands. Detected onsets keep correcting the phase, and if the music
// stops being regular it falls back to reacting.
import React, { useEffect, useRef, useState } from "react";
import NoteMark from "./NoteMark";

// --- onsets ---------------------------------------------------------
// A frame is an onset when its flux stands this far above the recent
// running flux, and is not merely the busiest moment of near-silence.
const FLUX_RATIO = 1.5;
const MIN_FLUX = 0.012;
// Nothing musical produces two onsets closer than this; below it you
// are detecting the texture of one hit.
const MIN_ONSET_GAP_MS = 120;
// How quickly the running flux average follows the music.
const FLUX_SMOOTHING = 0.9;

// --- tempo ----------------------------------------------------------
// 50–230bpm, which covers everything short of drum'n'bass counted in
// sixteenths. Intervals outside this are noise, not a pulse.
const MIN_PERIOD_MS = 260;
const MAX_PERIOD_MS = 1200;
// Intervals within this of the running estimate count as agreeing
// with it.
const PERIOD_TOLERANCE = 0.14;
// Agreeing intervals needed before prediction takes over from
// reaction.
const LOCK_AFTER = 3;
// How far ahead of the predicted beat a note leaves the record. The
// note is then visibly moving at the moment the beat arrives, which is
// what reads as "on the beat" — landing exactly on it reads as late.
const ANTICIPATION_MS = 110;
// Give up on the estimate after this long with nothing recognisable.
const LOCK_TIMEOUT = 2.6;

// --- notes ----------------------------------------------------------
const MAX_NOTES = 9;
// Used only when there is no analyser to read (the web build, or
// before anything has played through the graph this session).
const FALLBACK_EVERY_MS = 820;

let nextId = 0;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Half- and double-time readings of the same pulse are the usual
// failure of interval counting: a detector that catches every other
// kick reports double the period. Folding them in keeps one steady
// estimate instead of two fighting ones.
function foldToPeriod(interval, period) {
  if (!period) return interval;
  if (interval > period * 1.6) return interval / Math.round(interval / period);
  if (interval < period * 0.65) return interval * Math.round(period / interval);
  return interval;
}

function makeNote(levels, side) {
  const { level = 0.4, bass = 0.4, treble = 0.4 } = levels || {};

  // Sides alternate rather than being chosen by the spectrum. Deciding
  // position from treble-minus-bass sounded reasonable and was wrong in
  // practice: nearly all music carries far more energy low than high,
  // so that difference is almost always negative and almost every note
  // came off the left. The spectrum still colours the note — it just
  // doesn't get to decide which edge it leaves from.
  const spread = 16 + Math.random() * 15;
  const tilt = (treble - bass) * 8;
  const startX = Math.max(8, Math.min(92, 50 + side * spread + tilt));

  return {
    id: nextId++,
    startX,
    // Thrown outward, away from the record, so the side it left from
    // stays legible all the way down. Bass-heavy notes swing wider.
    drift: side * (6 + bass * 22),
    size: Math.round(9 + bass * 9),
    // Louder moments fall faster.
    duration: 2600 - Math.min(1100, level * 1400),
    spin: Math.round(side * (10 + Math.random() * 30)),
  };
}

export default function FallingNotes({ playing, getAudioLevels }) {
  const [notes, setNotes] = useState([]);

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

  const beatRef = useRef({
    fluxAverage: 0,
    lastOnsetAt: 0,
    intervals: [],
    period: 0,
    agreement: 0,
    nextBeatAt: 0,
    side: 1,
    lastEmit: 0,
  });

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

    const emit = (levels) => {
      const beat = beatRef.current;
      beat.side = -beat.side;
      const note = makeNote(levels, beat.side);
      setNotes((prev) => [...prev.slice(-(MAX_NOTES - 1)), note]);
      // Self-removing: an animationend handler would be tidier, but a
      // note can also be dropped from the list by MAX_NOTES before it
      // ever finishes, and then that event never arrives.
      setTimeout(() => {
        if (mountedRef.current) setNotes((prev) => prev.filter((n) => n.id !== note.id));
      }, note.duration + 80);
    };

    // Folds one inter-onset gap into the running tempo estimate and
    // reports how much the recent gaps agree with each other — which is
    // what decides whether this is a pulse worth predicting from.
    const learnTempo = (beat, interval) => {
      if (interval < MIN_PERIOD_MS || interval > MAX_PERIOD_MS) return;
      beat.intervals.push(foldToPeriod(interval, beat.period));
      if (beat.intervals.length > 8) beat.intervals.shift();

      const estimate = median(beat.intervals);
      beat.agreement = beat.intervals.filter(
        (value) => Math.abs(value - estimate) / estimate < PERIOD_TOLERANCE
      ).length;
      beat.period = estimate;
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      const beat = beatRef.current;
      const levels = levelsRef.current?.();

      if (!levels) {
        if (now - beat.lastEmit >= FALLBACK_EVERY_MS) {
          beat.lastEmit = now;
          emit(null);
        }
        return;
      }

      const flux = levels.flux || 0;
      beat.fluxAverage = beat.fluxAverage * FLUX_SMOOTHING + flux * (1 - FLUX_SMOOTHING);

      const isOnset =
        flux > MIN_FLUX &&
        flux > beat.fluxAverage * FLUX_RATIO &&
        now - beat.lastOnsetAt >= MIN_ONSET_GAP_MS;

      if (isOnset) {
        if (beat.lastOnsetAt) learnTempo(beat, now - beat.lastOnsetAt);
        beat.lastOnsetAt = now;

        if (beat.period && beat.agreement >= LOCK_AFTER) {
          // Nudge the predicted grid towards where the beat actually
          // landed, rather than resetting to it — a single syncopated
          // hit shouldn't drag the whole pulse off.
          const error = now - (beat.nextBeatAt - beat.period);
          if (Math.abs(error) < beat.period * 0.35) {
            beat.nextBeatAt += error * 0.25;
          } else {
            beat.nextBeatAt = now + beat.period;
          }
        }
      }

      const locked = beat.period && beat.agreement >= LOCK_AFTER;

      // The estimate has to be abandoned when the music stops agreeing
      // with it, or a tempo change would leave notes flying to a pulse
      // that is no longer there.
      if (locked && beat.lastOnsetAt && now - beat.lastOnsetAt > beat.period * LOCK_TIMEOUT) {
        beat.intervals = [];
        beat.agreement = 0;
        beat.period = 0;
        beat.nextBeatAt = 0;
        return;
      }

      if (locked) {
        if (!beat.nextBeatAt) beat.nextBeatAt = now + beat.period;
        // Ahead of the beat, not on it — see ANTICIPATION_MS.
        if (now >= beat.nextBeatAt - ANTICIPATION_MS) {
          beat.nextBeatAt += beat.period;
          beat.lastEmit = now;
          emit(levels);
        }
        return;
      }

      // Not locked yet: react to each onset, which is both the warm-up
      // for the estimate and the right behaviour for music with no
      // steady pulse to find.
      if (isOnset && now - beat.lastEmit >= MIN_ONSET_GAP_MS) {
        beat.lastEmit = now;
        emit(levels);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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
