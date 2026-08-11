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
