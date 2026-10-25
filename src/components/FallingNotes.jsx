// src/components/FallingNotes.jsx
// uPod's own note mark, shaken loose by whatever is playing and falling
// from the record down into the Instant Mix tile.
//
// Everything here is measured, never assumed. The earlier version used
// fixed thresholds ("flux above 0.012 is a beat"), which is the reason
// it worked on some songs and not others: those numbers are only
// meaningful against one mastering level. A quietly mastered album
// never crossed them and produced nothing at all, while a loud one
// crossed them constantly. Every threshold below is now relative to
// what *this* track has been doing for the last few seconds, so
// loudness, bitrate and genre stop mattering.
//
// It listens for three different things, because music does three
// different things:
//
//   beats     a sharp rise in spectral flux. Once the gaps between
//             them agree on a tempo it stops reacting and predicts,
//             releasing each note just before the beat is due.
//   sustain   energy with no new attacks — a held note, a singer
//             pulling one out. Those get long, slow, wide-drifting
//             notes instead of sharp ones.
//   vibrato   the wobble rate of the envelope during a sustain, which
//             is what a singer's tremble actually is. It drives the
//             note's own shiver.
//
// And a watchdog underneath all of it: if the track is audible and
// nothing has flown for a moment, something flies anyway. Silence is
// the only valid reason for an empty screen.
import React, { useEffect, useRef, useState } from "react";
import NoteMark from "./NoteMark";

// --- adaptive onset detection ---------------------------------------
// How far above its own recent average, in standard deviations, a
// flux reading has to sit to count as an attack. Standard deviations
// rather than a fixed figure is the whole point — it scales itself to
// the track.
const ONSET_K = 1.35;
// How quickly the running statistics follow the music: slow enough to
// still describe "recently", fast enough to track a change of section.
const STAT_SMOOTHING = 0.93;
// Nothing musical produces two attacks closer than this.
const MIN_ONSET_GAP_MS = 110;
// Fraction of the loudest recent moment below which the track is
// treated as silent — a gap between songs, or a fade. Relative, so a
// quiet master is not mistaken for silence.
const SILENCE_FRACTION = 0.1;
// The running peak decays, or one loud moment would set the silence
// floor impossibly high for the rest of the track.
const PEAK_DECAY = 0.9992;

// --- tempo ----------------------------------------------------------
const MIN_PERIOD_MS = 260;
const MAX_PERIOD_MS = 1200;
const PERIOD_TOLERANCE = 0.14;
const LOCK_AFTER = 3;
// How far ahead of the predicted beat a note leaves the record, so it
// is already moving when the beat lands. Landing exactly on it reads
// as late.
const ANTICIPATION_MS = 110;
const LOCK_TIMEOUT = 2.6;

// --- sustain --------------------------------------------------------
// Audible, but this long without an attack means something is being
// held rather than struck.
const SUSTAIN_AFTER_MS = 620;
const SUSTAIN_EVERY_MS = 520;

// --- the floor ------------------------------------------------------
// Audible and nothing emitted for this long: emit regardless. This is
// what guarantees every song produces notes, whatever its character.
const WATCHDOG_MS = 1100;
// Used when there is no analyser at all (the web build), or when the
// graph reports pure silence while the app believes it is playing —
// which means the audio is reaching the speakers by some path the
// analyser isn't on, and a visualiser that waits for data that will
// never arrive is worse than one that keeps a steady beat.
const FALLBACK_EVERY_MS = 760;
const DEAD_SIGNAL_MS = 900;

const MAX_NOTES = 11;

let nextId = 0;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Half- and double-time readings of the same pulse are the usual
// failure of interval counting: a detector that catches every other
// kick reports double the period.
function foldToPeriod(interval, period) {
  if (!period) return interval;
  if (interval > period * 1.6) return interval / Math.round(interval / period);
  if (interval < period * 0.65) return interval * Math.round(period / interval);
  return interval;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Turns a moment of audio into a note. Everything visible about it —
// where it starts, how big it is, how fast it falls, how it shivers —
// comes from the measurement, so two songs never produce the same
// shower.
function makeNote({ kind, levels, side, wobbleHz, intensity }) {
  const { bass = 0.4, treble = 0.4, centroid = 0.4 } = levels || {};
  const sustained = kind === "sustain";

  // Sides alternate rather than being chosen by the spectrum. Choosing
  // from treble-minus-bass sounded reasonable and was wrong: nearly all
  // music carries far more energy low than high, so that difference is
  // almost always negative and almost every note came off the left.
  // The spectrum still shapes the note, it just doesn't pick the edge.
  const spread = (sustained ? 20 : 14) + Math.random() * 15;
  const tilt = (treble - bass) * 8;

  // Brightness decides how the note behaves on the way down: a high,
  // bright moment throws a small quick note, a low one a big slow
  // one. This is the "highs and lows" of the track, made visible.
  const bright = clamp(centroid * 2.2, 0, 1);

  return {
    id: nextId++,
    kind,
    startX: clamp(50 + side * spread + tilt, 8, 92),
    // Thrown outward, so the side it left from stays legible all the
    // way down. A held note drifts much further than a struck one.
    drift: side * ((sustained ? 16 : 6) + bass * 22 + (1 - bright) * 10),
    size: Math.round((sustained ? 11 : 9) + (1 - bright) * 8 + intensity * 4),
    duration: Math.round(
      (sustained ? 3400 : 2500) - bright * 900 - intensity * 500
    ),
    spin: Math.round(side * (10 + Math.random() * 30) * (sustained ? 0.5 : 1)),
    // The shiver. A real vibrato sits around 4–7Hz; when none is
    // detected the note simply doesn't wobble.
    wobbleMs: wobbleHz > 0 ? Math.round(1000 / wobbleHz) : 0,
    wobblePx: wobbleHz > 0 ? clamp(1.5 + intensity * 4, 1.5, 6) : 0,
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

  // Removal timers outlive their effect run, so they check whether the
  // component is still here, not whether that run is.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beatRef = useRef(null);

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

    // Fresh statistics per playback run: carrying one track's loudness
    // into the next is exactly the mistake fixed thresholds made.
    const beat = {
      fluxMean: 0,
      fluxVariance: 0,
      levelPeak: 0,
      lastOnsetAt: 0,
      intervals: [],
      period: 0,
      agreement: 0,
      nextBeatAt: 0,
      levelSlow: 0,
      crossings: 0,
      crossSince: 0,
      wobbleHz: 0,
      lastSign: 0,
      deadSince: 0,
      side: 1,
      lastEmit: 0,
    };
    beatRef.current = beat;

    let frame;

    const emit = (kind, levels, intensity) => {
      beat.side = -beat.side;
      const note = makeNote({
        kind,
        levels,
        side: beat.side,
        wobbleHz: beat.wobbleHz,
        intensity: clamp(intensity, 0, 1),
      });
      setNotes((prev) => [...prev.slice(-(MAX_NOTES - 1)), note]);
      // Self-removing: an animationend handler would be tidier, but a
      // note can also be dropped from the list by MAX_NOTES before it
      // ever finishes, and then that event never arrives.
      setTimeout(() => {
        if (mountedRef.current) setNotes((prev) => prev.filter((n) => n.id !== note.id));
      }, note.duration + 80);
    };

    // Folds one inter-onset gap into the running tempo estimate and
    // reports how much the recent gaps agree — which is what decides
    // whether this is a pulse worth predicting from.
    const learnTempo = (interval) => {
      if (interval < MIN_PERIOD_MS || interval > MAX_PERIOD_MS) return;
      beat.intervals.push(foldToPeriod(interval, beat.period));
      if (beat.intervals.length > 8) beat.intervals.shift();
      const estimate = median(beat.intervals);
      beat.agreement = beat.intervals.filter(
        (value) => Math.abs(value - estimate) / estimate < PERIOD_TOLERANCE
      ).length;
      beat.period = estimate;
    };

    // Vibrato is the envelope oscillating around its own slow average,
    // so counting how often it crosses that average gives the rate
    // directly: two crossings per cycle.
    const trackVibrato = (now, level) => {
      beat.levelSlow = beat.levelSlow * 0.9 + level * 0.1;
      const sign = Math.sign(level - beat.levelSlow);
      if (sign !== 0 && beat.lastSign !== 0 && sign !== beat.lastSign) beat.crossings += 1;
      if (sign !== 0) beat.lastSign = sign;

      if (!beat.crossSince) beat.crossSince = now;
      const window = now - beat.crossSince;
      if (window >= 700) {
        const hz = beat.crossings / 2 / (window / 1000);
        // Outside roughly 3–9Hz it is not vibrato: slower is the song
        // breathing, faster is noise in the envelope.
        beat.wobbleHz = hz >= 3 && hz <= 9 ? hz : 0;
        beat.crossings = 0;
        beat.crossSince = now;
      }
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      const levels = levelsRef.current?.();

      // No analyser at all.
      if (!levels) {
        if (now - beat.lastEmit >= FALLBACK_EVERY_MS) {
          beat.lastEmit = now;
          emit("beat", null, 0.5);
        }
        return;
      }

      const { level = 0, flux = 0 } = levels;

      // An analyser that exists but reads nothing while the app says it
      // is playing means the sound is getting out by a path this isn't
      // on. Keep flying rather than waiting for data that won't come.
      if (level <= 0.0005) {
        if (!beat.deadSince) beat.deadSince = now;
        if (now - beat.deadSince >= DEAD_SIGNAL_MS && now - beat.lastEmit >= FALLBACK_EVERY_MS) {
          beat.lastEmit = now;
          emit("beat", null, 0.5);
        }
        return;
      }
      beat.deadSince = 0;

      // Running mean and variance of flux, which is what every
      // threshold here is expressed against.
      const delta = flux - beat.fluxMean;
      beat.fluxMean += delta * (1 - STAT_SMOOTHING);
      beat.fluxVariance =
        beat.fluxVariance * STAT_SMOOTHING + delta * delta * (1 - STAT_SMOOTHING);
      const fluxDeviation = Math.sqrt(beat.fluxVariance);

      beat.levelPeak = Math.max(beat.levelPeak * PEAK_DECAY, level);
      const audible = level > beat.levelPeak * SILENCE_FRACTION;

      trackVibrato(now, level);

      if (!audible) return;

      // How strong this moment is *for this track*, 0..1 — used for
      // note size and speed, so a track's own dynamics show up rather
      // than its mastering level.
      const intensity = clamp(level / (beat.levelPeak || 1), 0, 1);

      const isOnset =
        flux > beat.fluxMean + ONSET_K * fluxDeviation &&
        now - beat.lastOnsetAt >= MIN_ONSET_GAP_MS;

      if (isOnset) {
        if (beat.lastOnsetAt) learnTempo(now - beat.lastOnsetAt);
        beat.lastOnsetAt = now;

        if (beat.period && beat.agreement >= LOCK_AFTER) {
          // Nudge the predicted grid towards where the beat actually
          // landed rather than resetting to it — one syncopated hit
          // shouldn't drag the whole pulse off.
          const error = now - (beat.nextBeatAt - beat.period);
          if (Math.abs(error) < beat.period * 0.35) beat.nextBeatAt += error * 0.25;
          else beat.nextBeatAt = now + beat.period;
        }
      }

      const locked = beat.period && beat.agreement >= LOCK_AFTER;

      // Abandon the estimate when the music stops agreeing with it, or
      // a tempo change leaves notes flying to a pulse that has gone.
      if (locked && beat.lastOnsetAt && now - beat.lastOnsetAt > beat.period * LOCK_TIMEOUT) {
        beat.intervals = [];
        beat.agreement = 0;
        beat.period = 0;
        beat.nextBeatAt = 0;
      } else if (locked) {
        if (!beat.nextBeatAt) beat.nextBeatAt = now + beat.period;
        if (now >= beat.nextBeatAt - ANTICIPATION_MS) {
          beat.nextBeatAt += beat.period;
          beat.lastEmit = now;
          emit("beat", levels, intensity);
        }
        return;
      } else if (isOnset && now - beat.lastEmit >= MIN_ONSET_GAP_MS) {
        // Not locked: react to each attack, which both warms up the
        // estimate and is the right behaviour for music with no steady
        // pulse to find.
        beat.lastEmit = now;
        emit("beat", levels, intensity);
        return;
      }

      // Audible, but nothing is being struck — a held note. This is the
      // case the old detector had no answer for at all, and it is most
      // of what a ballad or a vocal passage consists of.
      const heldFor = now - (beat.lastOnsetAt || 0);
      if (heldFor >= SUSTAIN_AFTER_MS && now - beat.lastEmit >= SUSTAIN_EVERY_MS) {
        beat.lastEmit = now;
        emit("sustain", levels, intensity);
        return;
      }

      // The floor: audible, and nothing has flown for a while. Whatever
      // this track is doing, it gets notes.
      if (now - beat.lastEmit >= WATCHDOG_MS) {
        beat.lastEmit = now;
        emit(heldFor >= SUSTAIN_AFTER_MS ? "sustain" : "beat", levels, intensity);
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
          className={`falling-note is-${note.kind}`}
          style={{
            left: `${note.startX}%`,
            "--drift": `${note.drift}px`,
            "--spin": `${note.spin}deg`,
            animationDuration: `${note.duration}ms`,
          }}
        >
          {/* The shiver is a second animation on its own element: one
              element can't both fall and wobble without the two
              transforms overwriting each other. */}
          <span
            className="falling-note-body"
            style={
              note.wobbleMs
                ? { "--wobble": `${note.wobblePx}px`, animationDuration: `${note.wobbleMs}ms` }
                : undefined
            }
          >
            <NoteMark size={note.size} />
          </span>
        </span>
      ))}
    </div>
  );
}
