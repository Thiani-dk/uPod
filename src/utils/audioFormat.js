// src/utils/audioFormat.js
// Reads a track's REAL encoding properties — sample rate, bitrate, codec —
// straight out of the file's own container headers. Nothing here is
// hardcoded or guessed from the extension alone: the extension only picks
// which parser to run, every number comes from the bytes.
//
// Same non-destructive, partial-read principle the tag scanner already
// works under (see audio/nativeTagReader.js): this never pulls a track's
// audio payload through the bridge, only the few KB of header it needs.
// @capacitor/filesystem's readFile() takes native offset/length, so each
// lookup is one or two small range reads.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

// A moov atom that isn't found inside this much of the file is treated as
// unreadable rather than chased — some MP4s put moov at the very end, and
// walking the whole file for it would defeat the point of a partial read.
const MAX_ATOM_SCAN_BYTES = 12 * 1024 * 1024;
// Ceiling on a single moov read. Real music moov atoms are tens of KB;
// anything beyond this is pathological and not worth the allocation.
const MAX_MOOV_BYTES = 4 * 1024 * 1024;
// How far into an MP3 to hunt for the first frame sync after the ID3 tag.
const MP3_SYNC_SCAN_BYTES = 64 * 1024;

const cache = new Map(); // track.id -> Promise<format|null>

function base64ToBytes(base64) {
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return bytes;
}

// Both track flavours the library can hold: a browser-picked File (web
// folder picker, Studio renders) and a native descriptor that only knows
// where the file lives. Neither is read in full.
function makeReader(track) {
  if (track.file) {
    return {
      size: track.file.size,
      read: async (offset, length) =>
        new Uint8Array(await track.file.slice(offset, offset + length).arrayBuffer()),
    };
  }
  if (Capacitor.isNativePlatform() && track.folderPath && track.relativePath) {
    const path = `${track.folderPath}/${track.relativePath}`;
    return {
      size: track.size || track.sizeBytes || 0,
      read: async (offset, length) => {
        const result = await Filesystem.readFile({
          path,
          directory: Directory.ExternalStorage,
          offset,
          length,
        });
        return base64ToBytes(result.data);
      },
    };
  }
  return null;
}

function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
function u32le(b, i) { return ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0; }
function fourcc(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }

/* ---------------------------------------------------------------- MP3 */

// Layer III only — the only layer anything in a music library actually
// uses. Index 0 is "free" and 15 is "bad"; both are left as 0 so they fall
// through to the size/duration estimate instead of reporting a fake rate.
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};

function id3v2Size(head) {
  if (fourcc(head, 0).slice(0, 3) !== "ID3") return 0;
  // Syncsafe: seven bits per byte, high bit always clear.
  return 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
}

async function parseMp3(reader) {
  const head = await reader.read(0, 10);
  const start = id3v2Size(head);
  const buf = await reader.read(start, MP3_SYNC_SCAN_BYTES);

  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buf[i + 1] >> 3) & 0x03;
    const layerBits = (buf[i + 1] >> 1) & 0x03;
    const rateIndex = (buf[i + 2] >> 2) & 0x03;
    if (versionBits === 1 || layerBits !== 1 || rateIndex === 3) continue; // reserved values

    const sampleRate = SAMPLE_RATES[versionBits][rateIndex];
    const table = versionBits === 3 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES;
    let kbps = table[(buf[i + 2] >> 4) & 0x0f];
    const channelMode = (buf[i + 3] >> 6) & 0x03;
    const mono = channelMode === 3;

    // A VBR file's first frame header describes only that frame, so its
    // bitrate is meaningless as a headline number. The VBR header sitting
    // in that same first frame carries the real frame count, which turns
    // into an honest average. Its magic distinguishes the two cases for
    // us: "Xing" means VBR (average it), "Info" means the encoder wrote a
    // VBR-style header for a constant-bitrate file, in which case the
    // frame header's own value is already the right answer.
    const sideInfo = versionBits === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const tagAt = i + 4 + sideInfo;
    if (tagAt + 16 < buf.length && fourcc(buf, tagAt) === "Xing") {
      const flags = u32(buf, tagAt + 4);
      if (flags & 0x01) {
        const frames = u32(buf, tagAt + 8);
        const samplesPerFrame = versionBits === 3 ? 1152 : 576;
        const seconds = (frames * samplesPerFrame) / sampleRate;
        // `start + i` is where the audio actually begins — everything
        // before it is the ID3v2 tag, which on a track with embedded
        // cover art can be hundreds of KB and would inflate the average
        // by tens of kbps if it were counted as audio.
        const audioBytes = reader.size - (start + i);
        if (seconds > 0 && audioBytes > 0) kbps = Math.round((audioBytes * 8) / seconds / 1000);
      }
    }

    return { sampleRate, kbps: kbps || null, codec: "MP3", lossless: false, channels: mono ? 1 : 2 };
  }
  return null;
}

/* --------------------------------------------------------------- FLAC */

async function parseFlac(reader) {
  const head = await reader.read(0, 10);
  const start = id3v2Size(head); // rare, but a FLAC can carry an ID3v2 tag
  const buf = await reader.read(start, 64);
  if (fourcc(buf, 0) !== "fLaC") return null;

  // First metadata block is always STREAMINFO: 4-byte block header, then
  // the 34-byte payload. Sample rate is 20 bits, channels 3, bit depth 5,
  // total samples 36 — all packed, none byte-aligned.
  const b = buf.subarray(8); // past the "fLaC" magic and the 4-byte block header
  const p = 10; // into STREAMINFO: past min/max block size and min/max frame size
  const sampleRate = (b[p] << 12) | (b[p + 1] << 4) | (b[p + 2] >> 4);
  const channels = ((b[p + 2] >> 1) & 0x07) + 1;
  const bitDepth = ((((b[p + 2] & 0x01) << 4) | (b[p + 3] >> 4)) & 0x1f) + 1;
  const totalSamples = ((b[p + 3] & 0x0f) * 2 ** 32) + u32(b, p + 4);
  if (!sampleRate) return null;

  let kbps = null;
  if (totalSamples > 0 && reader.size > 0) {
    kbps = Math.round((reader.size * 8) / (totalSamples / sampleRate) / 1000);
  }
  return { sampleRate, kbps, codec: "FLAC", lossless: true, bitDepth, channels };
}

/* ------------------------------------------------------------- MP4/M4A */

// Walks top-level atoms by their declared size — never scans for a
// signature — and reads only the moov payload once it's located. mdat is
// stepped straight over, exactly like jsmediatags' MP4 reader does.
async function readMoov(reader) {
  let offset = 0;
  const limit = Math.min(reader.size || MAX_ATOM_SCAN_BYTES, MAX_ATOM_SCAN_BYTES);
  while (offset < limit) {
    const header = await reader.read(offset, 16);
    if (header.length < 8) return null;
    let size = u32(header, 0);
    let headerLen = 8;
    if (size === 1) {
      // 64-bit extended size. The high word is only ever non-zero for
      // files far larger than anything here, so the low word is enough.
      size = u32(header, 12);
      headerLen = 16;
    } else if (size === 0) {
      size = limit - offset; // "to end of file"
    }
    if (size < headerLen) return null;
    if (fourcc(header, 4) === "moov") {
      const payload = Math.min(size - headerLen, MAX_MOOV_BYTES);
      return reader.read(offset + headerLen, payload);
    }
    offset += size;
  }
  return null;
}

// Depth-first walk of a container atom's children, calling `visit` for
// each. Returns as soon as `visit` returns true.
function walkAtoms(buf, start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = u32(buf, offset);
    const type = fourcc(buf, offset + 4);
    if (size < 8 || offset + size > end) return false;
    if (visit(type, offset + 8, offset + size)) return true;
    offset += size;
  }
  return false;
}

// Pure container atoms only — deliberately excludes "meta"/"udta", which
// carry their own version/flags prefix and would misalign a plain walk.
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

function findMp4Info(moov) {
  const info = { sampleRate: 0, kbps: null, codec: null, lossless: false, channels: 0, seconds: 0 };

  function descend(from, to) {
    walkAtoms(moov, from, to, (type, bodyStart, bodyEnd) => {
      if (type === "mdhd") {
        const version = moov[bodyStart];
        const at = bodyStart + (version === 1 ? 20 : 12);
        const timescale = u32(moov, at);
        const duration = version === 1 ? u32(moov, at + 8) : u32(moov, at + 4);
        if (timescale > 0 && !info.seconds) info.seconds = duration / timescale;
      } else if (type === "stsd") {
        // version/flags (4) + entry count (4), then the sample entry.
        const entry = bodyStart + 8;
        const format = fourcc(moov, entry + 4);
        info.codec = format === "alac" ? "ALAC" : format === "mp4a" ? "AAC" : format.trim().toUpperCase();
        info.lossless = format === "alac";
        info.channels = u16(moov, entry + 24);
        // 16.16 fixed point; the fractional half is always zero in practice.
        info.sampleRate = u16(moov, entry + 32);
        // esds carries the encoder's own declared average bitrate, which
        // beats a size/duration estimate because it excludes the container.
        walkAtoms(moov, entry + 36, bodyEnd, (childType, childStart) => {
          if (childType !== "esds") return false;
          const avg = readEsdsAvgBitrate(moov, childStart, bodyEnd);
          if (avg) info.kbps = Math.round(avg / 1000);
          return true;
        });
      } else if (MP4_CONTAINERS.has(type)) {
        descend(bodyStart, bodyEnd);
      }
      return false;
    });
  }

  descend(0, moov.length);
  return info.sampleRate ? info : null;
}

// ES descriptors are tag/length pairs with a 7-bits-per-byte length. Only
// the DecoderConfigDescriptor (0x04) is wanted; it's reached through the
// ES_Descriptor (0x03), whose header length varies with its own flags.
function readEsdsAvgBitrate(buf, start, end) {
  let offset = start + 4; // version + flags
  function readLength() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = buf[offset++];
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    return value;
  }
  while (offset < end) {
    const tag = buf[offset++];
    const length = readLength();
    if (tag === 0x03) {
      offset += 2; // ES_ID
      const flags = buf[offset++];
      if (flags & 0x80) offset += 2; // streamDependenceFlag
      if (flags & 0x40) offset += 1 + buf[offset]; // URL_Flag
      if (flags & 0x20) offset += 2; // OCRstreamFlag
      continue; // fall through into the nested descriptors
    }
    if (tag === 0x04) return u32(buf, offset + 5 + 4); // avgBitrate follows maxBitrate
    offset += length;
  }
  return 0;
}

async function parseMp4(reader) {
  const moov = await readMoov(reader);
  if (!moov) return null;
  const info = findMp4Info(moov);
  if (!info) return null;
  if (!info.kbps && info.seconds > 0 && reader.size > 0) {
    info.kbps = Math.round((reader.size * 8) / info.seconds / 1000);
  }
  return info;
}

/* ---------------------------------------------------------------- OGG */

async function parseOgg(reader) {
  const buf = await reader.read(0, 4096);
  if (fourcc(buf, 0) !== "OggS") return null;
  const segments = buf[26];
  const packet = 27 + segments;

  if (fourcc(buf, packet + 1) === "vorb") {
    const sampleRate = u32le(buf, packet + 12);
    const channels = buf[packet + 11];
    const nominal = u32le(buf, packet + 20);
    return {
      sampleRate,
      kbps: nominal ? Math.round(nominal / 1000) : null,
      codec: "VORBIS",
      lossless: false,
      channels,
    };
  }
  if (fourcc(buf, packet) === "Opus") {
    // Opus always decodes to 48kHz regardless of what went in, so that —
    // not the "original rate" field — is the honest number to show.
    return { sampleRate: 48000, kbps: null, codec: "OPUS", lossless: false, channels: buf[packet + 9] };
  }
  return null;
}

/* ------------------------------------------------------------ public */

function extensionOf(track) {
  const name = track.relativePath || track.file?.name || track.title || "";
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

// "44.1KHZ 128kbps M4A" for lossy, "44.1KHZ 16bit FLAC" for lossless —
// a bitrate on a lossless file is a property of that one file's content,
// not of its quality, so the bit depth says more.
export function formatLabel(format) {
  if (!format) return null;
  const parts = [];
  if (format.sampleRate) {
    const khz = format.sampleRate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)}KHZ`);
  }
  if (format.lossless && format.bitDepth) parts.push(`${format.bitDepth}bit`);
  else if (format.kbps) parts.push(`${format.kbps}kbps`);
  if (format.container) parts.push(format.container);
  return parts.length ? parts.join(" ") : null;
}

// Resolves to null (never rejects) on anything unreadable — an unknown
// format is a blank info slot, not an error the UI has to handle.
export function readAudioFormat(track) {
  if (!track) return Promise.resolve(null);
  if (cache.has(track.id)) return cache.get(track.id);

  const promise = (async () => {
    const reader = makeReader(track);
    if (!reader) return null;
    const ext = extensionOf(track);
    let parsed = null;
    if (ext === "mp3") parsed = await parseMp3(reader);
    else if (ext === "flac") parsed = await parseFlac(reader);
    else if (ext === "m4a" || ext === "mp4" || ext === "aac") parsed = await parseMp4(reader);
    else if (ext === "ogg" || ext === "oga" || ext === "opus") parsed = await parseOgg(reader);
    if (!parsed) return null;
    return { ...parsed, container: ext.toUpperCase() };
  })().catch(() => null);

  cache.set(track.id, promise);
  return promise;
}
