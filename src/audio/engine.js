// src/audio/engine.js
// Wraps a single <audio> element in a real Web Audio graph:
// source -> [7 BiquadFilterNode peaking bands] -> destination
// Effects (slowed/reverb/nightcore/etc) get added onto this same graph in Phase 3.

export const EQ_FREQUENCIES = [60, 150, 400, 1000, 2400, 6000, 12000];

export const EQ_PRESETS = {
  Flat:        [0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [7, 5, 3, 0, -1, -1, 0],
  Treble:      [0, -1, -1, 0, 3, 5, 7],
  Vocal:       [-3, -2, 1, 4, 4, 1, -2],
};

export class AudioEngine {
  constructor(audioElement) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    // NOTE: createMediaElementSource can only be called ONCE per <audio>
    // element for its whole lifetime — the engine must be created exactly once.
    this.source = this.ctx.createMediaElementSource(audioElement);

    this.bands = EQ_FREQUENCIES.map((freq, i) => {
      const filter = this.ctx.createBiquadFilter();
      // First and last bands behave better as shelf filters; middle bands as peaking.
      filter.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });

    // Chain: source -> band0 -> band1 -> ... -> bandN -> destination
    let node = this.source;
    for (const band of this.bands) {
      node.connect(band);
      node = band;
    }
    node.connect(this.ctx.destination);

    // A tap off the end of the chain, for anything that wants to *see*
    // the audio rather than change it (Play Now's falling notes). An
    // AnalyserNode passes its input straight through and this one is
    // deliberately connected to nothing downstream, so it observes the
    // signal without adding a second path to the destination.
    //
    // fftSize 256 gives 128 bins — far more resolution than "is there a
    // beat, and is it bass or treble" needs, and cheap enough to read
    // every frame. The smoothing is what stops a visualiser built on it
    // from flickering on single-frame peaks.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    // Low smoothing on purpose. Heavy smoothing makes a prettier meter
    // but a useless onset detector: it rounds off the attack that marks
    // the beat and pushes the peak a frame or two late, which is
    // exactly the error you see as "the notes aren't quite on tempo".
    this.analyser.smoothingTimeConstant = 0.55;
    this._bins = new Uint8Array(this.analyser.frequencyBinCount);
    this._prevBins = new Uint8Array(this.analyser.frequencyBinCount);
    node.connect(this.analyser);
  }

  // A small summary of what is coming out of the speakers right now:
  // overall loudness plus where in the spectrum it sits, all 0..1.
  // Returns null when there is nothing to measure, so callers can tell
  // "silent" from "no audio graph" and fall back accordingly.
  getLevels() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this._bins);

    const bins = this._bins;
    const count = bins.length;
    // Bin 0 is DC and carries no musical information. The split points
    // are eighths of the spectrum: with a 44.1kHz context and 128 bins
    // each bin is ~172Hz, so "bass" here is roughly up to 2.7kHz and
    // "treble" from about 11kHz up — crude, but the question being
    // asked ("does this moment feel low or bright?") is crude too.
    const bassEnd = Math.floor(count / 8);
    const trebleStart = Math.floor((count * 5) / 8);

    const prev = this._prevBins;
    let total = 0;
    let bass = 0;
    let treble = 0;
    // Spectral flux: the sum of how much each band got *louder* since
    // the last frame, falls ignored. It is the standard onset measure
    // and a much better beat cue than loudness, which stays high
    // through a sustained note and so marks the middle of a sound
    // rather than its start.
    let flux = 0;
    // Spectral centroid: the magnitude-weighted average bin, i.e. where
    // the middle of the sound sits. It is the closest cheap stand-in
    // for "how high is this right now" — it rises with a voice going up
    // and with a bright section, and falls into a bass-heavy one.
    let weighted = 0;
    let peak = 0;
    for (let i = 1; i < count; i++) {
      const v = bins[i];
      total += v;
      weighted += v * i;
      if (v > peak) peak = v;
      if (i < bassEnd) bass += v;
      else if (i >= trebleStart) treble += v;
      const rise = v - prev[i];
      if (rise > 0) flux += rise;
      prev[i] = v;
    }

    const norm = (sum, n) => (n > 0 ? sum / n / 255 : 0);
    return {
      level: norm(total, count - 1),
      bass: norm(bass, bassEnd - 1),
      treble: norm(treble, count - trebleStart),
      flux: norm(flux, count - 1),
      // 0..1 across the spectrum rather than in Hz: every consumer of
      // this wants "low or high for this track", not a frequency.
      centroid: total > 0 ? weighted / total / count : 0,
      peak: peak / 255,
    };
  }

  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setBandGain(index, db) {
    if (this.bands[index]) this.bands[index].gain.value = db;
  }

  setAllBands(gainsArray) {
    gainsArray.forEach((db, i) => this.setBandGain(i, db));
  }
}
