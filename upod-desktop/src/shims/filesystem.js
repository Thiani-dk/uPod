// src/shims/filesystem.js
// Stands in for @capacitor/filesystem. The app addresses files as a path
// relative to Directory.ExternalStorage, which on the phone meant
// /storage/emulated/0. Here that root is the desktop library folder
// (~/Music/uPod by default), so a stored path like
// "Download/Music Downloads/track.mp3" keeps working untouched — which is
// why the phone's preferences and track ids survive the move.
import { native } from "./emitter";

export const Directory = {
  Documents: "DOCUMENTS",
  Data: "DATA",
  Library: "LIBRARY",
  Cache: "CACHE",
  External: "EXTERNAL",
  ExternalStorage: "EXTERNAL_STORAGE",
};

export const Encoding = {
  UTF8: "utf8",
  ASCII: "ascii",
  UTF16: "utf16",
};

export const Filesystem = {
  readdir: ({ path }) => native().fs.readdir({ path }),

  // offset/length are honoured as a real partial read. The tag scanner
  // leans on this hard: without it, scanning the library would mean
  // reading gigabytes instead of a few KB of header per track.
  readFile: ({ path, offset, length }) => native().fs.readFile({ path, offset, length }),

  writeFile: ({ path, data, encoding }) => native().fs.writeFile({ path, data, encoding }),
  deleteFile: ({ path }) => native().fs.deleteFile({ path }),
  mkdir: ({ path, recursive }) => native().fs.mkdir({ path, recursive }),
  stat: ({ path }) => native().fs.stat({ path }),
  checkPermissions: () => native().fs.permissions(),
  requestPermissions: () => native().fs.permissions(),
};

export default Filesystem;
