// src/audio/mp3.js
// Encodes an AudioBuffer to a real MP3 Blob using lamejs, and appends a
// simple ID3v1 tag (title/artist/album) — ID3v1 is a fixed 128-byte
// trailer, which is the simplest reliable way to tag MP3s from the browser
// without a full ID3v2 frame writer.

import lamejs from "@breezystack/lamejs";

function floatTo16BitPCM(channelData) {
  const out = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function buildId3v1Tag({ title = "", artist = "", album = "", track = 0 }) {
  const buf = new Uint8Array(128);
  const enc = new TextEncoder();
  const writeField = (offset, len, str) => {
    const bytes = enc.encode(str).slice(0, len);
    buf.set(bytes, offset);
  };
  writeField(0, 3, "TAG");
  writeField(3, 30, title);
  writeField(33, 30, artist);
  writeField(63, 30, album);
  writeField(93, 4, ""); // year
  // Bytes 97-125 = comment (28 bytes when using ID3v1.1 track number trick)
  buf[125] = 0; // zero byte before track number signals ID3v1.1
  buf[126] = track && track > 0 ? track : 0;
  buf[127] = 0xff; // genre unknown
  return buf;
}

export async function audioBufferToMp3Blob(audioBuffer, meta = {}, kbps = 192) {
  const channels = audioBuffer.numberOfChannels >= 2 ? 2 : 1;
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);

  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = channels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const blockSize = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    let mp3buf;
    if (channels === 2) {
      const rightChunk = right.subarray(i, i + blockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = encoder.encodeBuffer(leftChunk);
    }
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));

  chunks.push(buildId3v1Tag(meta));

  return new Blob(chunks, { type: "audio/mpeg" });
}
