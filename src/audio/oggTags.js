// src/audio/oggTags.js
// Vorbis comments out of an Ogg container — the tags of an .opus or .ogg
// file.
//
// Why this exists: jsmediatags, which reads every other format uPod
// supports, has readers for ID3v1/ID3v2, MP4 and native FLAC and nothing
// for Ogg. Every "Best available" download is Opus (YouTube's best free
// audio stream, remuxed rather than re-encoded — see qualityPresets.js),
// so *every* best-quality download arrived in the library with no title,
// no artist and no album, however carefully yt-dlp had tagged it.
//
// That one gap produced both halves of a long-standing complaint: with
// no album tag each track became an album of one, and with no title or
// artist the track scored UNKNOWN metadata origin and was held out of
// the general pool, so it was missing from the Tracks tab and from Play
// Now's "Recently Added" too. Confirmed on a real download: the file
// carried `title=` and `artist=` in its OpusTags packet the whole time.
//
// The format (RFC 7845 §5.2 for Opus, Vorbis I §5 for Vorbis) is small
// enough to read directly, and doing so avoids pulling in a second
// tag library for one container.

// An Ogg page's fixed header, before the segment table.
const PAGE_HEADER_BYTES = 27;
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

function readU32LE(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function readU32BE(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function matchesAt(bytes, at, signature) {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[at + i] !== signature[i]) return false;
  }
  return true;
}

function asciiSignature(text) {
  return [...text].map((c) => c.charCodeAt(0));
}

const UTF8 = new TextDecoder("utf-8", { fatal: false });

// Rebuilds the logical bitstream by concatenating page payloads in
// order. Packets can straddle page boundaries — a comment header with
// cover art routinely does — and the lacing values in each page's
// segment table are what say where a page's payload ends. Pages
// belonging to any other logical stream are skipped: a bare .opus has
// only one, but reading the serial costs nothing and multiplexed files
// exist.
function concatPagePayloads(bytes) {
  const chunks = [];
  let offset = 0;
  let serial = null;
  let total = 0;

  while (offset + PAGE_HEADER_BYTES <= bytes.length) {
    if (!matchesAt(bytes, offset, OGG_MAGIC)) break;

    const pageSerial = readU32LE(bytes, offset + 14);
    const segmentCount = bytes[offset + 26];
    const tableStart = offset + PAGE_HEADER_BYTES;
    const payloadStart = tableStart + segmentCount;
    if (payloadStart > bytes.length) break;

    let payloadLength = 0;
    for (let i = 0; i < segmentCount; i++) payloadLength += bytes[tableStart + i];

    if (serial === null) serial = pageSerial;
    if (pageSerial === serial) {
      // A truncated final page is still worth keeping: the comment
      // packet is at the very front of the file, so a short read
      // usually holds all of it even when it holds no complete page.
      const end = Math.min(payloadStart + payloadLength, bytes.length);
      chunks.push(bytes.subarray(payloadStart, end));
      total += end - payloadStart;
    }

    offset = payloadStart + payloadLength;
    // Three pages is already past the identification header and the
    // comment header on any normal file; going further would mean
    // walking the audio payload, which is exactly what this module
    // exists to avoid.
    if (chunks.length >= 3) break;
  }

  const stream = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    stream.set(chunk, at);
    at += chunk.length;
  }
  return stream;
}

// A FLAC-style METADATA_BLOCK_PICTURE, which is how a Vorbis comment
// carries cover art (base64-encoded into the comment's value).
function parsePictureBlock(bytes) {
  try {
    let at = 4; // picture type
    const mimeLength = readU32BE(bytes, at);
    at += 4;
    const mime = UTF8.decode(bytes.subarray(at, at + mimeLength));
    at += mimeLength;
    const descriptionLength = readU32BE(bytes, at);
    at += 4 + descriptionLength;
    at += 16; // width, height, colour depth, indexed colours
    const dataLength = readU32BE(bytes, at);
    at += 4;
    if (!dataLength || at + dataLength > bytes.length) return null;
    return { format: mime || "image/jpeg", data: bytes.subarray(at, at + dataLength) };
  } catch {
    return null;
  }
}

function decodeBase64(text) {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// Vorbis comments proper: a vendor string, then a count, then that many
// "KEY=value" entries, every one length-prefixed. Shared verbatim
// between Opus and Vorbis — only the packet signature in front of it
// differs.
function parseCommentList(bytes, start) {
  let at = start;
  if (at + 4 > bytes.length) return null;
  const vendorLength = readU32LE(bytes, at);
  at += 4 + vendorLength;
  if (at + 4 > bytes.length) return null;
  const count = readU32LE(bytes, at);
  at += 4;

  // A corrupt or misparsed length would otherwise send this into a very
  // long loop over nonsense.
  if (count > 1024) return null;

  const comments = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.length) {
      // Ran out of data mid-list: the caller gets what was read so far
      // and the fact that it was cut short, so it can decide whether to
      // re-read more of the file.
      return { comments, truncated: true };
    }
    const length = readU32LE(bytes, at);
    at += 4;
    if (at + length > bytes.length) return { comments, truncated: true };
    comments.push(UTF8.decode(bytes.subarray(at, at + length)));
    at += length;
  }
  return { comments, truncated: false };
}

const OPUS_TAGS = asciiSignature("OpusTags");
const VORBIS_COMMENT = [0x03, ...asciiSignature("vorbis")];

function findCommentStart(stream) {
  // Bounded rather than scanning the whole buffer: the comment header is
  // the second packet in the stream by specification, so anything found
  // far into the file would be a coincidence in the audio data.
  const limit = Math.min(stream.length, 4096);
  for (let i = 0; i < limit; i++) {
    if (matchesAt(stream, i, OPUS_TAGS)) return i + OPUS_TAGS.length;
    if (matchesAt(stream, i, VORBIS_COMMENT)) return i + VORBIS_COMMENT.length;
  }
  return -1;
}

// Maps the handful of keys that mean something here onto the shape
// jsmediatags hands back for every other format, so metadata.js's
// buildTrackFromTags doesn't need to know which reader produced them.
function tagsFromComments(comments) {
  const tags = {};
  for (const comment of comments) {
    const splitAt = comment.indexOf("=");
    if (splitAt <= 0) continue;
    const key = comment.slice(0, splitAt).trim().toUpperCase();
    const value = comment.slice(splitAt + 1);
    if (!value) continue;

    switch (key) {
      case "TITLE":
        tags.title = tags.title || value;
        break;
      case "ARTIST":
        tags.artist = tags.artist || value;
        break;
      case "ALBUM":
        tags.album = tags.album || value;
        break;
      case "ALBUMARTIST":
      case "ALBUM ARTIST":
        tags.albumArtist = tags.albumArtist || value;
        break;
      case "TRACKNUMBER":
        tags.track = tags.track || value;
        break;
      case "GENRE":
        tags.genre = tags.genre || value;
        break;
      case "DATE":
      case "YEAR":
        // yt-dlp writes a full upload date here ("20050424"); the
        // library only ever shows a year, and a four-digit prefix is
        // the year in both that form and a plain "2005".
        if (!tags.year) {
          const match = String(value).match(/\d{4}/);
          if (match) tags.year = match[0];
        }
        break;
      case "METADATA_BLOCK_PICTURE": {
        if (tags.picture) break;
        const decoded = decodeBase64(value);
        const picture = decoded && parsePictureBlock(decoded);
        if (picture) tags.picture = picture;
        break;
      }
      default:
        break;
    }
  }
  return tags;
}

// `bytes` is the front of the file — enough of it to cover the comment
// header. Returns null when this isn't an Ogg file at all, and
// `{ tags, truncated }` otherwise, where truncated means the comment
// list ran past the bytes provided and re-reading more would find more.
export function parseOggTags(bytes) {
  if (!bytes || bytes.length < PAGE_HEADER_BYTES || !matchesAt(bytes, 0, OGG_MAGIC)) return null;

  const stream = concatPagePayloads(bytes);
  const start = findCommentStart(stream);
  if (start === -1) return null;

  const parsed = parseCommentList(stream, start);
  if (!parsed) return null;
  return { tags: tagsFromComments(parsed.comments), truncated: parsed.truncated };
}

export function isOggFile(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return ext === "ogg" || ext === "opus";
}

// How much of the file to read on the first attempt. Comfortably covers
// a normal comment header; a file that carries embedded cover art needs
// the larger read below, and says so by coming back truncated.
export const OGG_FIRST_READ_BYTES = 16 * 1024;
export const OGG_SECOND_READ_BYTES = 512 * 1024;
