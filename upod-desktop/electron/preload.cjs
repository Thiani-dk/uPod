// electron/preload.cjs
// The only thing the renderer can see of Node. Everything the shims need
// is listed explicitly — the React app keeps running with no idea it
// isn't talking to a Capacitor bridge.
const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

function on(channel, handler) {
  const wrapped = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  const key = Symbol("sub");
  listeners.set(key, { channel, wrapped });
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(key);
  };
}

contextBridge.exposeInMainWorld("upodNative", {
  fs: {
    readdir: (opts) => ipcRenderer.invoke("fs:readdir", opts),
    readFile: (opts) => ipcRenderer.invoke("fs:readFile", opts),
    stat: (opts) => ipcRenderer.invoke("fs:stat", opts),
    writeFile: (opts) => ipcRenderer.invoke("fs:writeFile", opts),
    deleteFile: (opts) => ipcRenderer.invoke("fs:deleteFile", opts),
    mkdir: (opts) => ipcRenderer.invoke("fs:mkdir", opts),
    permissions: () => ipcRenderer.invoke("fs:permissions"),
  },
  prefs: {
    get: (opts) => ipcRenderer.invoke("prefs:get", opts),
    set: (opts) => ipcRenderer.invoke("prefs:set", opts),
    remove: (opts) => ipcRenderer.invoke("prefs:remove", opts),
    keys: () => ipcRenderer.invoke("prefs:keys"),
    clear: () => ipcRenderer.invoke("prefs:clear"),
  },
  download: {
    prepare: () => ipcRenderer.invoke("dl:prepare"),
    start: (opts) => ipcRenderer.invoke("dl:start", opts),
    cancel: (opts) => ipcRenderer.invoke("dl:cancel", opts),
    update: () => ipcRenderer.invoke("dl:update"),
    search: (opts) => ipcRenderer.invoke("dl:search", opts),
    notifyBatchComplete: (opts) => ipcRenderer.invoke("dl:notifyBatchComplete", opts),
    clearNotifications: (opts) => ipcRenderer.invoke("dl:clearNotifications", opts),
    getPendingReview: () => ipcRenderer.invoke("dl:getPendingReview"),
    onProgress: (h) => on("dl:progress", h),
    onDone: (h) => on("dl:done", h),
    onFailed: (h) => on("dl:failed", h),
    onReviewRequested: (h) => on("dl:reviewRequested", h),
  },
  share: {
    getPending: () => ipcRenderer.invoke("share:getPending"),
    onShared: (h) => on("share:url", h),
    setClipboardWatch: (opts) => ipcRenderer.invoke("share:setClipboardWatch", opts),
    getClipboardWatch: () => ipcRenderer.invoke("share:getClipboardWatch"),
  },
  http: {
    request: (opts) => ipcRenderer.invoke("http:request", opts),
  },
  media: {
    onKey: (h) => on("media:key", h),
  },
  // Window shape, driven by the desktop keyboard layer. Nothing in the
  // phone app knows or asks about any of this.
  win: {
    setCompact: (enabled) => ipcRenderer.invoke("win:setCompact", { enabled }),
    getCompact: () => ipcRenderer.invoke("win:getCompact"),
    toggleFullScreen: () => ipcRenderer.invoke("win:toggleFullScreen"),
    minimize: () => ipcRenderer.invoke("win:minimize"),
    onCompactChange: (h) => on("win:compact", h),
  },
  app: {
    exit: () => ipcRenderer.invoke("app:exit"),
    openExternal: (url) => ipcRenderer.invoke("app:openExternal", { url }),
    getLibraryRoot: () => ipcRenderer.invoke("app:getLibraryRoot"),
    chooseLibraryRoot: () => ipcRenderer.invoke("app:chooseLibraryRoot"),
    revealInFolder: (p) => ipcRenderer.invoke("app:revealInFolder", { path: p }),
  },
});
