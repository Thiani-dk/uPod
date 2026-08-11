// src/audio/studioEffects.js
// Offline (non-realtime) audio rendering for all 8 Studio effects.
// Each effect decodes the source file once, builds a fresh Web Audio graph
// inside an OfflineAudioContext, and renders a brand-new AudioBuffer —
// the original file is never touched.

export const STUDIO_EFFECTS = [
  { id: "slowed", label: "Slowed", desc: "Tempo and pitch both drop — playbackRate 0.85" },
  { id: "reverb", label: "Reverb", desc: "Generated impulse-response reverb tail" },
  { id: "slowed-reverb", label: "Slowed + Reverb", desc: "Both combined — the classic 'slowed + reverb' sound" },
  { id: "nightcore", label: "Nightcore", desc: "Sped up and pitched up — playbackRate 1.25" },
  { id: "daycore", label: "Daycore", desc: "Slowed further with an extra pitch drop for a heavy, moody vocal" },
  { id: "lofi", label: "Lo-Fi / Vinyl", desc: "Low-pass warmth, crackle, and a gentle pitch wobble" },
  { id: "telephone", label: "Telephone / Megaphone", desc: "Narrow bandpass filter — sounds like a cheap speaker or phone call" },
  { id: "reverse-reverb", label: "Reverse Reverb", desc: "Reverb tail swells in backwards before the track plays forward" },
  { id: "8d", label: "8D Audio", desc: "Slow auto-panning between ears with a gentle tremolo" },
];

async function decodeFile(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const tempCtx = new Ctx();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  tempCtx.close();
  return audioBuffer;
}

// Manually reverses every channel of an AudioBuffer (used for reverse-reverb).
function reverseBuffer(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  }
  return out;
}

// Generates a synthetic reverb impulse response (exponentially decaying noise).
function makeImpulseResponse(ctx, seconds = 2.5, decay = 3.2) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

// Generates vinyl-style crackle/dust noise as a looping buffer.
function makeCrackleBuffer(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      // Sparse random pops + low-level hiss
      const hiss = (Math.random() * 2 - 1) * 0.02;
      const pop = Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.6 : 0;
      data[i] = hiss + pop;
    }
  }
  return buffer;
}

function addWetDry(ctx, wetNode, dryNode, destination, wetAmount = 0.35) {
  const wetGain = ctx.createGain();
  wetGain.gain.value = wetAmount;
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - wetAmount * 0.4;
  wetNode.connect(wetGain).connect(destination);
  dryNode.connect(dryGain).connect(destination);
}

// Builds and renders the offline graph for a given effect. Returns a rendered AudioBuffer.
async function renderGraph(sourceBuffer, effectId) {
  const rateMap = { slowed: 0.85, "slowed-reverb": 0.85, nightcore: 1.25, daycore: 0.8 };
  const rate = rateMap[effectId] || 1;
  const renderSeconds = sourceBuffer.duration / rate + (effectId.includes("reverb") ? 2.5 : 0);
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(
    sourceBuffer.numberOfChannels,
    Math.ceil(renderSeconds * sourceBuffer.sampleRate),
    sourceBuffer.sampleRate
  );

  const bufferForGraph = effectId === "reverse-reverb" ? reverseBuffer(ctx, sourceBuffer) : sourceBuffer;

  const src = ctx.createBufferSource();
  src.buffer = bufferForGraph;

  switch (effectId) {
    case "slowed":
    case "nightcore": {
      src.playbackRate.value = rate;
      src.connect(ctx.destination);
      break;
    }
    case "daycore": {
      src.playbackRate.value = rate;
      src.detune.value = -350; // extra pitch drop beyond the rate change
      src.connect(ctx.destination);
      break;
    }
    case "reverb":
    case "slowed-reverb": {
      if (effectId === "slowed-reverb") src.playbackRate.value = rate;
      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulseResponse(ctx);
      const splitter = ctx.createGain();
      src.connect(splitter);
      splitter.connect(convolver);
      addWetDry(ctx, convolver, splitter, ctx.destination, 0.4);
      break;
    }
    case "reverse-reverb": {
      // Source buffer is already reversed. Convolve it (reverb tail lands
      // at what becomes the START once we reverse the render back).
      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulseResponse(ctx, 2.0, 2.5);
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      const dry = ctx.createGain();
      dry.gain.value = 0.9;
      src.connect(convolver).connect(wet).connect(ctx.destination);
      src.connect(dry).connect(ctx.destination);
      break;
    }
    case "lofi": {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 3400;
      lowpass.Q.value = 0.7;

      // Gentle pitch wobble via an LFO modulating detune.
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 0.7;
      const wobbleGain = ctx.createGain();
      wobbleGain.gain.value = 12; // cents
      wobble.connect(wobbleGain).connect(src.detune);
      wobble.start(0);

      const crackle = ctx.createBufferSource();
      crackle.buffer = makeCrackleBuffer(ctx, sourceBuffer.duration);
      crackle.loop = true;
      const crackleGain = ctx.createGain();
      crackleGain.gain.value = 0.5;

      src.connect(lowpass).connect(ctx.destination);
      crackle.connect(crackleGain).connect(ctx.destination);
      crackle.start(0);
      break;
    }
    case "telephone": {
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 1500;
      bandpass.Q.value = 2.2;

      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.tanh(x * 2.2); // mild saturation
      }
      shaper.curve = curve;

      src.connect(bandpass).connect(shaper).connect(ctx.destination);
      break;
    }
    case "8d": {
      const panner = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12; // one full left-right sweep ~every 8s
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 1; // pan range -1..1
      lfo.connect(lfoGain).connect(panner.pan);
      lfo.start(0);

      const tremolo = ctx.createGain();
      const tremLfo = ctx.createOscillator();
      tremLfo.frequency.value = 0.24;
      const tremGain = ctx.createGain();
      tremGain.gain.value = 0.15;
      const tremOffset = ctx.createConstantSource();
      tremOffset.offset.value = 0.85;
      tremLfo.connect(tremGain).connect(tremolo.gain);
      tremOffset.connect(tremolo.gain);
      tremLfo.start(0);
      tremOffset.start(0);

      src.connect(panner).connect(tremolo).connect(ctx.destination);
      break;
    }
    default: {
      src.connect(ctx.destination);
    }
  }

  src.start(0);
  const rendered = await ctx.startRendering();
  return effectId === "reverse-reverb" ? reverseBuffer(ctx, rendered) : rendered;
}

// Public entry point: renders `effectId` applied to `track.file`, returns
// { audioBuffer, suggestedFileName }. Caller is responsible for encoding
// (see wav.js) and filing it into a playlist.
export async function renderStudioEffect(track, effectId, onStatus) {
  onStatus?.("Decoding source file…");
  const sourceBuffer = await decodeFile(track.file);

  onStatus?.("Rendering effect…");
  const renderedBuffer = await renderGraph(sourceBuffer, effectId);

  const effectDef = STUDIO_EFFECTS.find((e) => e.id === effectId);
  const baseName = track.title.replace(/[\\/:*?"<>|]/g, "").trim() || "track";
  const suggestedFileName = `${baseName} (${effectDef.label}).wav`;

  return { audioBuffer: renderedBuffer, suggestedFileName, effectDef };
}
