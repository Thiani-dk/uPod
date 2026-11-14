// src/shims/capacitor-core.js
// Stands in for @capacitor/core. Two jobs:
//
//   1. Report that this IS a native platform. The app branches on
//      isNativePlatform() in ~40 places, and on the false branch it
//      disables folder scanning, downloads, deletion and the media
//      session — i.e. everything the user actually wants here. Claiming
//      "web" would give a crippled app; claiming native and then
//      honouring the plugin contracts gives the real one.
//
//   2. Resolve registerPlugin(name) to the desktop implementation of
//      each Java plugin, with matching method and event names.
import { createEmitter, native } from "./emitter";

const PLATFORM = "electron";

export const Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => PLATFORM,
  isPluginAvailable: (name) => name in PLUGINS,
  // Used where the app wants a src= for a file path. The library root is
  // served by the app's own custom handling; blob URLs are produced by
  // readNativeTrackObjectUrl, so this is only a fallback.
  convertFileSrc: (filePath) => (filePath?.startsWith("file://") ? filePath : `file://${filePath}`),
};

// --- AudioDownload: the AudioDownloadPlugin.java port ----------------------
function makeAudioDownload() {
  const bus = createEmitter();
  let wired = false;

  const wire = () => {
    if (wired) return;
    wired = true;
    const n = native().download;
    n.onProgress((p) => bus.emit("progress", p));
    n.onDone((p) => bus.emit("done", p));
    n.onFailed((p) => bus.emit("failed", p));
    n.onReviewRequested(() => bus.emit("reviewRequested", {}));
  };

  return {
    prepare: () => native().download.prepare(),
    update: () => native().download.update(),
    search: (opts) => native().download.search(opts),
    start: (opts) => {
      wire();
      return native().download.start(opts);
    },
    cancel: (opts) => native().download.cancel(opts),
    notifyBatchComplete: (opts) => native().download.notifyBatchComplete(opts),
    clearNotifications: (opts) => native().download.clearNotifications(opts),
    getPendingReview: () => native().download.getPendingReview(),
    addListener: (event, handler) => {
      wire();
      return bus.addListener(event, handler);
    },
    removeAllListeners: bus.removeAllListeners,
  };
}

// --- ShareTarget: the ShareTargetPlugin.java port --------------------------
// Same two arrival paths as Android — a share that cold-started the app is
// parked for getPending(), a share into a running uPod fires "shared" —
// so onSharedUrl() in the app works unchanged.
function makeShareTarget() {
  const bus = createEmitter();
  let wired = false;
  const wire = () => {
    if (wired) return;
    wired = true;
    native().share.onShared((p) => bus.emit("shared", p));
  };

  return {
    getPending: () => {
      wire();
      return native().share.getPending();
    },
    setClipboardWatch: (opts) => native().share.setClipboardWatch(opts),
    getClipboardWatch: () => native().share.getClipboardWatch(),
    addListener: (event, handler) => {
      wire();
      return bus.addListener(event, handler);
    },
    removeAllListeners: bus.removeAllListeners,
  };
}

// --- AllFilesAccess -------------------------------------------------------
// `applicable: false` is the honest answer on a desktop: the Android
// all-files-access concept doesn't exist here. The app then falls back to
// Filesystem.checkPermissions(), which reports granted — so the permission
// screens never appear and the library just loads.
const AllFilesAccess = {
  check: async () => ({ granted: true, applicable: false }),
  openSettings: async () => ({}),
};

// --- Plugins whose OS counterpart the desktop handles for us --------------
// AudioFocus, NoisyAudio and PlaybackWakeLock existed to fight Android
// problems that don't arise here: the window manager won't kill a
// foreground app's audio, and nothing steals focus mid-track. They
// resolve successfully and emit nothing, so the app's call sites stay on
// their normal path.
function makeInertPlugin(extraMethods = {}) {
  const bus = createEmitter();
  return {
    addListener: bus.addListener,
    removeAllListeners: bus.removeAllListeners,
    ...extraMethods,
  };
}

const AudioFocus = makeInertPlugin({
  requestFocus: async () => ({ granted: true }),
  abandonFocus: async () => ({}),
});

const NoisyAudio = makeInertPlugin();

const PlaybackWakeLock = makeInertPlugin({
  acquire: async () => ({}),
  release: async () => ({}),
});

// Desktop notifications need no runtime grant on Linux; the app's
// permission prompt is skipped by answering granted.
const NotificationPermission = {
  checkPermissions: async () => ({ notifications: "granted" }),
  requestPermissions: async () => ({ notifications: "granted" }),
};

const PLUGINS = {
  AudioDownload: makeAudioDownload(),
  ShareTarget: makeShareTarget(),
  AllFilesAccess,
  AudioFocus,
  NoisyAudio,
  PlaybackWakeLock,
  NotificationPermission,
};

export function registerPlugin(name) {
  const impl = PLUGINS[name];
  if (!impl) {
    console.warn(`uPod desktop: no shim for plugin "${name}"; calls will no-op.`);
    return makeInertPlugin();
  }
  return impl;
}

// --- CapacitorHttp --------------------------------------------------------
// Only the Spotify resolver uses this, and only because the request must
// escape the renderer's CORS rules. The main process makes it instead and
// reports the final URL after redirects, which is what turns a
// spotify.link shortlink into a track id.
export const CapacitorHttp = {
  request: (options) => native().http.request(options),
  get: (options) => native().http.request({ ...options, method: "GET" }),
  post: (options) => native().http.request({ ...options, method: "POST" }),
  put: (options) => native().http.request({ ...options, method: "PUT" }),
  patch: (options) => native().http.request({ ...options, method: "PATCH" }),
  delete: (options) => native().http.request({ ...options, method: "DELETE" }),
};

export const WebPlugin = class {};
export default { Capacitor, registerPlugin, CapacitorHttp };
