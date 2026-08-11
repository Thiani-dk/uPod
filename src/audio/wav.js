// src/audio/wav.js
// Encodes an AudioBuffer into a WAV Blob, with basic metadata written into
// a RIFF LIST/INFO chunk (artist, title) — the closest thing to ID3 tags
// that plain WAV supports without a dedicated encoder library.

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function buildInfoChunk(meta) {
  const fields = [];
  if (meta.title) fields.push(["INAM", meta.title]);
  if (meta.artist) fields.push(["IART", meta.artist]);
  if (meta.album) fields.push(["IPRD", meta.album]);
  if (meta.comment) fields.push(["ICMT", meta.comment]);

  let size = 4; // "INFO"
  const encoded = fields.map(([id, val]) => {
    const bytes = new TextEncoder().encode(val + "\0");
    const padded = bytes.length % 2 === 0 ? bytes.length : bytes.length + 1;
    size += 8 + padded;
    return { id, bytes, padded };
  });

  const buf = new ArrayBuffer(8 + size);
  const view = new DataView(buf);
  writeString(view, 0, "LIST");
  view.setUint32(4, size, true);
  writeString(view, 8, "INFO");
  let offset = 12;
  for (const f of encoded) {
    writeString(view, offset, f.id);
    view.setUint32(offset + 4, f.padded, true);
    new Uint8Array(buf, offset + 8, f.bytes.length).set(f.bytes);
    offset += 8 + f.padded;
  }
  return new Uint8Array(buf);
}

export function audioBufferToWavBlob(audioBuffer, meta = {}) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numFrames * numChannels * bytesPerSample;

  const infoChunk = buildInfoChunk(meta);
  const headerSize = 44;
  const totalSize = headerSize + dataSize + infoChunk.length;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels and convert float32 [-1,1] -> int16
  const channelData = [];
  for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  new Uint8Array(buf, headerSize + dataSize, infoChunk.length).set(infoChunk);

  return new Blob([buf], { type: "audio/wav" });
}
