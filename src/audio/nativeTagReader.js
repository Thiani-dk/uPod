// src/audio/nativeTagReader.js
// Lets jsmediatags read ID3v2/ID3v1/MP4/FLAC tags from a file living in
// Android shared storage without ever touching the audio payload.
//
// jsmediatags' tag readers (ID3v2TagReader, ID3v1TagReader, MP4TagReader,
// FLACTagReader — see node_modules/jsmediatags/build2/*.js) already only
// request the specific byte ranges they need: a small header first, then
// exactly the declared tag size (ID3v2), the last 128 bytes (ID3v1), atom
// headers plus the 'moov' atom while skipping over 'mdat' by offset alone
// (MP4), or individual metadata blocks (FLAC). They get those ranges by
// calling `loadRange([start, end], callbacks)` on whatever MediaFileReader
// subclass is supplied via `Reader.setFileReader(...)` (documented in
// jsmediatags' README under "Development").
//
// @capacitor/filesystem's readFile() gained native `offset`/`length`
// options in 8.1.0 (this project uses 8.1.2) — see
// node_modules/@capacitor/filesystem/dist/esm/definitions.d.ts. This class
// wires the two together: each loadRange() becomes exactly one partial
// native read instead of the whole file being pulled through the bridge.
import { Filesystem } from "@capacitor/filesystem";
// Deep imports into jsmediatags' compiled output (not part of its public
// entry point, which only exports {read, Reader, Config}) — this is the
// same module family Vite resolves for the top-level `import jsmediatags
// from "jsmediatags"` used elsewhere (verified against the build output:
// both come from build2/, so there's no risk of a second incompatible copy
// of MediaFileReader/ChunkedFileData floating around).
import MediaFileReader from "jsmediatags/build2/MediaFileReader";
import ChunkedFileData from "jsmediatags/build2/ChunkedFileData";
import jsmediatags from "jsmediatags";

function base64ToUint8Array(base64) {
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return bytes;
}

class NativeRangeFileReader extends MediaFileReader {
  constructor({ path, directory, size }) {
    super();
    this._path = path;
    this._directory = directory;
    this._size = size;
    this._fileData = new ChunkedFileData();
  }

  _init(callbacks) {
    // Size comes from the readdir() entry that found this file, so no
    // extra native round trip (e.g. a stat() call) is needed just to
    // start reading ranges.
    setTimeout(callbacks.onSuccess, 0);
  }

  loadRange(range, callbacks) {
    const offset = range[0];
    const length = range[1] - range[0] + 1;
    Filesystem.readFile({ path: this._path, directory: this._directory, offset, length })
      .then((result) => {
        this._fileData.addData(offset, base64ToUint8Array(result.data));
        callbacks.onSuccess();
      })
      .catch((err) => {
        if (callbacks.onError) callbacks.onError({ type: "native-range-read", info: err.message || err });
      });
  }

  getByteAt(offset) {
    return this._fileData.getByteAt(offset);
  }

  static canReadFile() {
    // Never auto-detected — only ever used explicitly via setFileReader().
    return false;
  }
}

// Resolves to `{}` (rather than rejecting) on any failure, matching
// metadata.js's existing readTagsFromFile() behaviour for browser File
// objects, so a single unreadable/corrupt track can't abort a whole scan.
export function readNativeTags({ path, directory, size }) {
  return new Promise((resolve) => {
    new jsmediatags.Reader({ path, directory, size })
      .setFileReader(NativeRangeFileReader)
      .read({
        onSuccess: (tag) => resolve(tag.tags),
        onError: () => resolve({}),
      });
  });
}
