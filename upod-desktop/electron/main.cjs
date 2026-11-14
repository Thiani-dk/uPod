// electron/main.cjs
// The desktop stand-in for everything uPod's Android half provided.
//
// The React app in ../upod/src is reused byte-for-byte; it still calls
// @capacitor/filesystem, registerPlugin("AudioDownload") and so on. Vite
// aliases those imports to the shims in ../src/shims, and every shim
// bottoms out in one of the IPC handlers below. So this file is, in
// effect, the port of the Java plugins — same method names, same event
// names, same payload shapes.
const { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, clipboard, dialog, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const { spawn } = require("node:child_process");
const os = require("node:os");

const isDev = !app.isPackaged && process.env.UPOD_DEV === "1";
// Set UPOD_SMOKE=1 to load the shim smoke test instead of the app: it
// drives the real library through the real app modules and quits with a
// pass/fail summary, which is the only way to check the port end to end
// without a human watching the window.
const isSmoke = process.env.UPOD_SMOKE === "1";
const DEV_SERVER = "http://localhost:5180";

// ---------------------------------------------------------------------------
// Where the library lives
// ---------------------------------------------------------------------------
// On the phone every music path was relative to /storage/emulated/0 (what
// @capacitor/filesystem calls Directory.ExternalStorage). The app stores
// and reasons about folder paths like "Download/Music Downloads", so the
// cheapest way to keep every stored preference and every track id valid
// across the two platforms is to keep that shape and only swap the root.
const DEFAULT_LIBRARY_ROOT = path.join(os.homedir(), "Music", "uPod");
const CONFIG_DIR = path.join(app.getPath("userData"));
const CONFIG_FILE = path.join(CONFIG_DIR, "upod-desktop.json");
const PREFS_FILE = path.join(CONFIG_DIR, "preferences.json");

let config = { libraryRoot: DEFAULT_LIBRARY_ROOT };

function loadConfig() {
  try {
    Object.assign(config, JSON.parse(fssync.readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    /* first run */
  }
}
function saveConfig() {
  try {
    fssync.mkdirSync(CONFIG_DIR, { recursive: true });
    fssync.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.warn("Couldn't persist desktop config:", err);
  }
}

// Every path crossing the bridge is confined under the library root. The
// renderer is running code that was written for a sandboxed WebView; it
// has no business reading ~/.ssh, and a malformed relativePath from a
// weird filename shouldn't be able to escape either.
function resolveUnderRoot(relPath) {
  const root = config.libraryRoot;
  const full = path.resolve(root, relPath || "");
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the library folder: ${relPath}`);
  }
  return full;
}

// The Android shared-storage root the app reasons in. Paths going *in*
// are mapped off it (see dl:start); paths coming *out* have to be mapped
// back onto it, or the app can't recognise its own downloads:
// relativePathFromAbsolute() in nativeFolder.js only accepts a path under
// `/storage/emulated/0/<music folder>/`, and anything else it drops. That
// is what silently skipped the post-download review sheet — the files
// saved correctly, but ingestDownloadedFiles() got an empty list and the
// arrivals card had nothing to announce.
const ANDROID_ROOT = "/storage/emulated/0";

function toAppPath(absolutePath) {
  const rel = path.relative(config.libraryRoot, absolutePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return absolutePath;
  return `${ANDROID_ROOT}/${rel.split(path.sep).join("/")}`;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let mainWindow = null;

// Where the window was last time. A desktop app that opens at the same
// size and place it was closed at is the difference between a ported
// phone app and one that belongs here — and it is the first thing anyone
// notices after resizing a window once.
function savedWindowState() {
  const s = config.window;
  if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return {};
  const area = screen.getDisplayMatching(s).workArea;
  // Only restore a position still on a screen that exists: unplugging the
  // monitor it was on shouldn't open the window off in the void.
  const onScreen =
    Number.isFinite(s.x) &&
    Number.isFinite(s.y) &&
    s.x < area.x + area.width &&
    s.x + s.width > area.x &&
    s.y < area.y + area.height &&
    s.y + s.height > area.y;
  return {
    width: Math.min(s.width, area.width),
    height: Math.min(s.height, area.height),
    ...(onScreen ? { x: s.x, y: s.y } : {}),
  };
}

// What the window manager was last asked for — see rememberWindowState.
let requestedBounds = null;

function rememberWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Never record the compact bar as the window to come back to — mini
  // mode is a mode, not a size preference.
  if (compactMode) return;
  const maximized = mainWindow.isMaximized();
  if (maximized) {
    // Keep whatever size it had before being maximised, so unmaximising
    // after a restart lands back on the real window rather than on
    // whatever the screen happens to be.
    config.window = { ...(config.window || {}), maximized: true };
  } else {
    // Content bounds rather than window bounds, because GNOME's
    // decorations aren't an exact round trip — and then anchored to what
    // was actually asked for.
    //
    // This display runs fractional scaling, so every logical→physical→
    // logical trip rounds: ask for 1182 and the compositor settles on
    // 1184, which then gets saved, restored, and rounded again. The
    // window grew a couple of pixels on every launch. Within a few
    // pixels of the request, the request is the honest answer; a real
    // drag moves far further than that and replaces the anchor.
    const bounds = mainWindow.getContentBounds();
    const near = (a, b) => Math.abs(a - b) <= 4;
    const asked = requestedBounds;
    const settled =
      asked && near(bounds.width, asked.width) && near(bounds.height, asked.height) && near(bounds.x, asked.x) && near(bounds.y, asked.y)
        ? asked
        : bounds;
    requestedBounds = settled;
    config.window = { ...settled, maximized: false };
  }
  saveConfig();
}

function createWindow() {
  const restored = savedWindowState();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    ...restored,
    // Narrow enough for the phone layout the app still falls back to,
    // and short enough for the compact bar mini mode shrinks to.
    minWidth: 360,
    minHeight: 120,
    backgroundColor: "#0b0b0d",
    title: "uPod",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The app creates blob: URLs for decoded audio and reads cover art
      // from disk; nothing here needs to reach the open web except the
      // metadata lookups the app already makes over https.
      webSecurity: true,
    },
  });

  const page = isSmoke ? "smoke.html" : "index.html";
  if (isDev) {
    mainWindow.loadURL(`${DEV_SERVER}/${page}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", page));
  }

  // External links (MusicBrainz, a track's YouTube source) belong in the
  // user's real browser, not in a chrome-less app window they can't
  // navigate back out of.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Renderer console into the terminal. The app logs real diagnostics
  // (scan progress, playback failures) that are otherwise invisible
  // unless DevTools happens to be open.
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const tag = ["debug", "info", "warn", "error"][level] || "log";
    if (isSmoke) {
      console.log(message);
      if (message.includes("SMOKE_DONE")) app.exit(0);
      return;
    }
    if (tag === "warn" || tag === "error") {
      console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] process gone:", details.reason);
  });

  // Restored again here, in content coordinates, because the
  // constructor's width/height describe the *outer* window: feeding it a
  // saved content size and then saving the outer frame back grew the
  // window a few pixels on every launch. setContentBounds reads back
  // exactly what getContentBounds wrote.
  if (Number.isFinite(restored.width) && Number.isFinite(restored.x)) {
    requestedBounds = { x: restored.x, y: restored.y, width: restored.width, height: restored.height };
    mainWindow.setContentBounds(requestedBounds);
  }

  if (config.window?.maximized) mainWindow.maximize();

  // Only geometry the *user* produced is worth saving. Restoring bounds
  // makes the window manager answer with its own slightly-adjusted
  // geometry, and saving that echo is what made the window creep a
  // couple of pixels wider every launch. So the first moment after
  // startup is ignored; the close handler below saves regardless, which
  // covers a resize inside that window.
  let settling = true;
  setTimeout(() => {
    settling = false;
  }, 2000);

  // Debounced: a drag fires these continuously, and the point is to
  // record where the drag ended, not every pixel of it.
  let saveTimer = null;
  const scheduleSave = () => {
    if (settling) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(rememberWindowState, 400);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);

  mainWindow.on("close", () => {
    clearTimeout(saveTimer);
    settling = false;
    rememberWindowState();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Mini mode — the compact always-on-top bar
// ---------------------------------------------------------------------------
// The one desktop convention a phone layout has no answer for: music
// playing in a corner while you work on something else. Apple Music and
// Spotify both have a version of it, and the complaint people have about
// Apple's is that it only offers fixed sizes — so this one is a normal
// resizable window that simply starts small, and the layout follows the
// height rather than a mode flag (see desktop.css).
let compactMode = false;
const COMPACT_SIZE = { width: 480, height: 148 };

function setCompactMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return { compact: compactMode };
  if (enabled === compactMode) return { compact: compactMode };

  if (enabled) {
    rememberWindowState();
    compactMode = true;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    mainWindow.setMinimumSize(320, 110);
    mainWindow.setBounds({
      ...COMPACT_SIZE,
      // Bottom right, where a now-playing widget belongs, with room for
      // a dock or panel.
      x: area.x + area.width - COMPACT_SIZE.width - 24,
      y: area.y + area.height - COMPACT_SIZE.height - 24,
    });
    mainWindow.setAlwaysOnTop(true, "floating");
  } else {
    compactMode = false;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(360, 120);
    const restored = savedWindowState();
    mainWindow.setBounds({
      width: restored.width || 1180,
      height: restored.height || 820,
      ...(Number.isFinite(restored.x) ? { x: restored.x, y: restored.y } : {}),
    });
    if (config.window?.maximized) mainWindow.maximize();
  }
  send("win:compact", { compact: compactMode });
  return { compact: compactMode };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Filesystem — the @capacitor/filesystem surface the app actually uses
// ---------------------------------------------------------------------------
ipcMain.handle("fs:readdir", async (_e, { path: p }) => {
  const dir = resolveUnderRoot(p);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    let size = 0;
    let mtime = 0;
    try {
      const st = await fs.stat(path.join(dir, entry.name));
      size = st.size;
      // Capacitor reports mtime in milliseconds and nativeFolder.js
      // fingerprints the library with it, so the unit has to match or
      // every launch would look like the folder had changed.
      mtime = Math.round(st.mtimeMs);
    } catch {
      /* vanished mid-walk; report it with zeroes rather than failing the scan */
    }
    files.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size,
      mtime,
      uri: `file://${path.join(dir, entry.name)}`,
    });
  }
  return { files };
});

// Supports the partial reads the tag scanner depends on: jsmediatags asks
// for a few kilobytes of header rather than the whole track, which is the
// only reason scanning 775 files is quick instead of reading 4.4 GB.
ipcMain.handle("fs:readFile", async (_e, { path: p, offset, length }) => {
  const full = resolveUnderRoot(p);
  if (offset || length) {
    const handle = await fs.open(full, "r");
    try {
      const st = await handle.stat();
      const start = offset || 0;
      const want = length ? Math.min(length, Math.max(0, st.size - start)) : Math.max(0, st.size - start);
      const buf = Buffer.alloc(want);
      await handle.read(buf, 0, want, start);
      return { data: buf.toString("base64") };
    } finally {
      await handle.close();
    }
  }
  const buf = await fs.readFile(full);
  return { data: buf.toString("base64") };
});

ipcMain.handle("fs:stat", async (_e, { path: p }) => {
  const st = await fs.stat(resolveUnderRoot(p));
  return {
    type: st.isDirectory() ? "directory" : "file",
    size: st.size,
    mtime: Math.round(st.mtimeMs),
    ctime: Math.round(st.ctimeMs),
    uri: `file://${resolveUnderRoot(p)}`,
  };
});

ipcMain.handle("fs:writeFile", async (_e, { path: p, data, encoding }) => {
  const full = resolveUnderRoot(p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, encoding === "utf8" ? data : Buffer.from(data, "base64"));
  return { uri: `file://${full}` };
});

ipcMain.handle("fs:deleteFile", async (_e, { path: p }) => {
  await fs.unlink(resolveUnderRoot(p));
  return {};
});

ipcMain.handle("fs:mkdir", async (_e, { path: p, recursive }) => {
  await fs.mkdir(resolveUnderRoot(p), { recursive: recursive !== false });
  return {};
});

// On Android this gated the all-files-access grant. A desktop app reading
// a folder the user owns needs no such ceremony, so it answers "granted"
// and the app's permission screens fall away.
ipcMain.handle("fs:permissions", async () => ({ publicStorage: "granted" }));

// ---------------------------------------------------------------------------
// Preferences — @capacitor/preferences, backed by one JSON file
// ---------------------------------------------------------------------------
let prefs = {};
function loadPrefs() {
  try {
    prefs = JSON.parse(fssync.readFileSync(PREFS_FILE, "utf8"));
  } catch {
    prefs = {};
  }
}
let prefsWriteTimer = null;
function savePrefs() {
  // The app writes playback position and listening stats often; batching
  // keeps that from becoming a write per second.
  clearTimeout(prefsWriteTimer);
  prefsWriteTimer = setTimeout(() => {
    try {
      fssync.mkdirSync(CONFIG_DIR, { recursive: true });
      fssync.writeFileSync(PREFS_FILE, JSON.stringify(prefs));
    } catch (err) {
      console.warn("Couldn't persist preferences:", err);
    }
  }, 250);
}

ipcMain.handle("prefs:get", (_e, { key }) => ({ value: key in prefs ? prefs[key] : null }));
ipcMain.handle("prefs:set", (_e, { key, value }) => {
  prefs[key] = value;
  savePrefs();
  return {};
});
ipcMain.handle("prefs:remove", (_e, { key }) => {
  delete prefs[key];
  savePrefs();
  return {};
});
ipcMain.handle("prefs:keys", () => ({ keys: Object.keys(prefs) }));
ipcMain.handle("prefs:clear", () => {
  prefs = {};
  savePrefs();
  return {};
});

// ---------------------------------------------------------------------------
// Downloads — the AudioDownloadPlugin port
// ---------------------------------------------------------------------------
function ytDlpPath() {
  const bundled = path.join(__dirname, "..", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return fssync.existsSync(bundled) ? bundled : "yt-dlp";
}

function ffmpegPath() {
  try {
    // ffmpeg-static resolves to a path inside node_modules; yt-dlp needs
    // the containing directory for --ffmpeg-location.
    const p = require("ffmpeg-static");
    if (p && fssync.existsSync(p)) return p;
  } catch {
    /* fall through to whatever is on PATH */
  }
  return null;
}

const jobs = new Map();

function isPlaylistUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has("list") || u.pathname.startsWith("/playlist");
  } catch {
    return false;
  }
}

function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 180).trim();
}

ipcMain.handle("dl:prepare", async () => {
  // Android had to unpack a bundled CPython here. On desktop the only
  // thing worth checking is that the binary is actually present, so a
  // missing yt-dlp surfaces as a clear message at picker-open time
  // rather than as a failed download later.
  const bin = ytDlpPath();
  if (bin === "yt-dlp") {
    const found = await new Promise((res) => {
      const probe = spawn("yt-dlp", ["--version"]);
      probe.on("error", () => res(false));
      probe.on("close", (code) => res(code === 0));
    });
    if (!found) throw new Error("yt-dlp isn't installed. Run `npm run setup` in upod-desktop.");
  }
  return {};
});

ipcMain.handle("dl:update", async () => {
  await new Promise((resolve, reject) => {
    const p = spawn(ytDlpPath(), ["-U"]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`yt-dlp -U exited ${code}`))));
  });
  return {};
});

// Mirrors the Java search(): one cheap flat-playlist request, one JSON
// object per line, parsed on the JS side.
ipcMain.handle("dl:search", async (_e, { query, limit }) => {
  const args = [
    `ytsearch${limit || 5}:${query}`,
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
  ];
  const out = await new Promise((resolve, reject) => {
    const p = spawn(ytDlpPath(), args);
    let buf = "";
    let err = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error(err || `search exited ${code}`))));
  });
  return { results: out.split("\n").filter((l) => l.trim()) };
});

ipcMain.handle("dl:start", async (_e, { id, url, directory, format, recode, outputName }) => {
  // `directory` arrives as the absolute Android-style path the app built
  // from its folder preference. Only the part under the root is
  // meaningful here, so it's mapped back onto the desktop library root.
  const rel = directory.startsWith(ANDROID_ROOT) ? directory.slice(ANDROID_ROOT.length + 1) : directory;
  const dir = resolveUnderRoot(rel);
  await fs.mkdir(dir, { recursive: true });

  const template =
    outputName && outputName.trim() ? `${sanitizeName(outputName)}.%(ext)s` : "%(title)s [%(id)s].%(ext)s";

  const args = ["-f", format || "bestaudio/best", "-x"];
  if (recode && recode.codec) {
    args.push("--audio-format", recode.codec);
    if (recode.bitrate) args.push("--audio-quality", recode.bitrate);
  } else {
    args.push("--audio-format", "best");
  }
  args.push("--embed-metadata");
  if (isPlaylistUrl(url)) {
    args.push("--yes-playlist");
    args.push("--parse-metadata", "playlist_title:%(meta_album)s");
    args.push("--parse-metadata", "playlist_index:%(meta_track)s");
  } else {
    args.push("--no-playlist");
  }
  args.push("-o", path.join(dir, template));
  // Without this a download carries YouTube's upload date as its mtime
  // and scatters through a date-sorted library instead of landing on top.
  args.push("--no-mtime");
  args.push("--print", "after_move:filepath");
  args.push("--no-simulate");
  // --print implies --quiet, and quiet suppresses progress; --progress
  // forces the progress lines back on so the dock can move.
  args.push("--progress", "--newline");
  const ff = ffmpegPath();
  if (ff) args.push("--ffmpeg-location", ff);
  args.push(url);

  const proc = spawn(ytDlpPath(), args);
  jobs.set(id, proc);

  const produced = [];
  let stderr = "";

  proc.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // A path line is yt-dlp answering --print; anything else that
      // carries a percentage is progress.
      if (trimmed.startsWith(dir)) {
        if (!produced.includes(trimmed)) produced.push(trimmed);
        continue;
      }
      const pct = trimmed.match(/(\d{1,3}(?:\.\d)?)%/);
      if (pct) {
        send("dl:progress", { id, percent: Number(pct[1]), line: trimmed });
      }
    }
  });

  proc.stderr.on("data", (d) => {
    stderr += d;
  });

  proc.on("error", (err) => {
    jobs.delete(id);
    send("dl:failed", { id, error: err.message });
  });

  proc.on("close", (code) => {
    jobs.delete(id);
    if (code === 0 && produced.length) {
      // `paths` is the key App.jsx's pathsFromDoneEvent() reads for a
      // multi-file job (a shared playlist URL is one job, many tracks);
      // `path` is the single-file fallback it checks after that.
      const appPaths = produced.map(toAppPath);
      send("dl:done", { id, paths: appPaths, path: appPaths[0] });
    } else {
      send("dl:failed", {
        id,
        error: stderr.trim().split("\n").slice(-3).join("\n") || `yt-dlp exited ${code}`,
      });
    }
  });

  return { id };
});

ipcMain.handle("dl:cancel", async (_e, { id }) => {
  jobs.get(id)?.kill("SIGTERM");
  jobs.delete(id);
  return {};
});

// The shade's half of "your download finished" — a real desktop
// notification, clicking which raises the window and asks the app for its
// review screen, exactly as tapping the Android notification did.
let pendingReview = false;

ipcMain.handle("dl:notifyBatchComplete", async (_e, { title, text, lines }) => {
  if (!Notification.isSupported()) return {};
  const n = new Notification({
    title: title || "Downloads finished",
    body: text || (lines || []).join("\n"),
  });
  n.on("click", () => {
    pendingReview = true;
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    send("dl:reviewRequested", {});
  });
  n.show();
  return {};
});

ipcMain.handle("dl:clearNotifications", async () => {
  pendingReview = false;
  return {};
});

ipcMain.handle("dl:getPendingReview", async () => {
  const was = pendingReview;
  pendingReview = false;
  return { pending: was };
});

// ---------------------------------------------------------------------------
// HTTP — the CapacitorHttp surface
// ---------------------------------------------------------------------------
// Used only by the Spotify resolver, and for the same reason it was used
// on Android: the request has to come from outside the web view's origin
// rules. A renderer fetch() to open.spotify.com would be refused by CORS,
// so it is made from the main process, which has no such rules — and the
// final post-redirect URL comes back, which is how a spotify.link
// shortlink yields its track id.
ipcMain.handle("http:request", async (_e, { url, method, headers, data }) => {
  const res = await fetch(url, {
    method: method || "GET",
    headers: headers || {},
    body: data ?? undefined,
    redirect: "follow",
  });
  const text = await res.text();
  const outHeaders = {};
  res.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  return { data: text, status: res.status, headers: outHeaders, url: res.url };
});

// ---------------------------------------------------------------------------
// Share — the desktop answer to Android's share sheet
// ---------------------------------------------------------------------------
// There is no OS share intent to receive on a laptop, so uPod offers the
// two routes that do exist, both landing on the same handler the Android
// share used:
//   1. upod:// links, via the browser bookmarklet installed by setup
//   2. a global hotkey (Ctrl+Alt+U) that takes the current clipboard URL
//
// There was a third — a clipboard watcher that opened the quality picker
// the moment a media link was copied. Removed deliberately: copying a
// YouTube link is something you do for all sorts of reasons, and having
// the app jump in front of you each time is an interruption, not a
// feature. Ctrl+Alt+U is the same thing, asked for on purpose.
let pendingSharedUrl = null;

const MEDIA_HOST = /(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com|soundcloud\.com|instagram\.com|spotify\.com|spotify\.link)$/;

function looksLikeMediaUrl(text) {
  try {
    const u = new URL(text.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && MEDIA_HOST.test(u.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

function deliverShare(url) {
  if (!url) return;
  console.log(`[share] ${url}`);
  pendingSharedUrl = url;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  send("share:url", { url });
}

// Takes whatever is on the clipboard, if it's a media link. This is what
// Ctrl+Alt+U ends up calling — see the hotkey notes further down for why
// it arrives as a link rather than as a key event.
function shareClipboard() {
  const text = clipboard.readText().trim();
  if (looksLikeMediaUrl(text)) {
    deliverShare(text);
    return true;
  }
  console.log(`[hotkey] clipboard holds no media link: "${text.slice(0, 60)}"`);
  // Still worth coming forward: the user asked for uPod, and a window
  // that never appears is indistinguishable from a broken shortcut.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  return false;
}

// upod://download?url=<encoded> — what the bookmarklet opens.
// upod://clipboard — what the Ctrl+Alt+U keybinding opens.
function handleDeepLink(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== "upod:") return;
    if (u.hostname === "clipboard" || u.pathname.replace(/\//g, "") === "clipboard") {
      shareClipboard();
      return;
    }
    const target = u.searchParams.get("url");
    if (target) deliverShare(target);
  } catch {
    /* malformed link; nothing to share */
  }
}

ipcMain.handle("share:getPending", async () => {
  const url = pendingSharedUrl;
  pendingSharedUrl = null;
  return { url };
});

// Kept as answering no-ops rather than deleted: the app's Settings screen
// asks about the clipboard watcher on every launch, and a missing handler
// is an unhandled rejection rather than a toggle that simply reads off.
ipcMain.handle("share:setClipboardWatch", async () => ({}));

ipcMain.handle("share:getClipboardWatch", async () => ({ enabled: false }));

// ---------------------------------------------------------------------------
// Small native odds and ends
// ---------------------------------------------------------------------------
ipcMain.handle("app:exit", () => app.quit());

// Window controls for the desktop keyboard layer (see src/desktop-keys.js).
ipcMain.handle("win:setCompact", (_e, { enabled }) => setCompactMode(!!enabled));
ipcMain.handle("win:getCompact", () => ({ compact: compactMode }));
ipcMain.handle("win:toggleFullScreen", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { fullScreen: false };
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return { fullScreen: next };
});
ipcMain.handle("win:minimize", () => {
  mainWindow?.minimize();
  return {};
});
ipcMain.handle("app:openExternal", (_e, { url }) => shell.openExternal(url));
ipcMain.handle("app:getLibraryRoot", () => ({ root: config.libraryRoot }));

ipcMain.handle("app:chooseLibraryRoot", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choose your uPod music folder",
    defaultPath: config.libraryRoot,
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { root: config.libraryRoot, changed: false };
  config.libraryRoot = res.filePaths[0];
  saveConfig();
  return { root: config.libraryRoot, changed: true };
});

ipcMain.handle("app:revealInFolder", (_e, { path: p }) => {
  try {
    shell.showItemInFolder(resolveUnderRoot(p));
  } catch {
    /* outside the library; nothing to reveal */
  }
});

// Android's AudioFocus/NoisyAudio/WakeLock had real OS counterparts. On a
// desktop the window manager handles the equivalents, so these resolve
// successfully and do nothing — the app's call sites stay on their happy
// path without any branching for platform.
ipcMain.handle("noop", async () => ({}));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
// Second-instance handling is what makes the bookmarklet work: clicking a
// upod:// link when uPod is already running hands the URL to the running
// copy instead of starting a second one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith("upod://"));
    if (link) handleDeepLink(link);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    loadConfig();
    loadPrefs();
    fssync.mkdirSync(config.libraryRoot, { recursive: true });

    if (process.defaultApp) {
      app.setAsDefaultProtocolClient("upod", process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient("upod");
    }

    createWindow();

    // Hardware/media keys, forwarded to the same handlers the Android
    // media-session notification drove.
    const keys = {
      MediaPlayPause: "playpause",
      MediaNextTrack: "next",
      MediaPreviousTrack: "previous",
      MediaStop: "stop",
    };
    for (const [accel, action] of Object.entries(keys)) {
      try {
        globalShortcut.register(accel, () => send("media:key", { action }));
      } catch {
        /* another app owns this key; not fatal */
      }
    }
    // "Download what I just copied" — the one and only way a copied link
    // reaches uPod, and only when it is asked for. Said out loud when it
    // fails: unlike the media keys, this one is the whole download
    // workflow, and a silent "another app already owns Ctrl+Alt+U" would
    // look like the app ignoring the keypress.
    //
    // Only on X11. globalShortcut is an X11 key grab, and Wayland gives
    // no application the ability to grab a key it isn't focused for —
    // registration still *succeeds* there, which is exactly how this was
    // missed: the shortcut reported itself as registered and then never
    // fired once. On Wayland the compositor owns the binding instead:
    // install-desktop-integration.sh registers Ctrl+Alt+U with GNOME,
    // pointed at `upod://clipboard`, which lands in handleDeepLink above.
    if (process.env.XDG_SESSION_TYPE !== "wayland") {
      try {
        const taken = !globalShortcut.register("Control+Alt+U", () => shareClipboard());
        if (taken) console.warn("[hotkey] Ctrl+Alt+U is already taken by another app — share by upod:// link instead");
      } catch {
        /* hotkey taken */
      }
    }

    // A upod:// link that cold-started the app arrives in argv.
    const link = process.argv.find((a) => a.startsWith("upod://"));
    if (link) handleDeepLink(link);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    for (const proc of jobs.values()) proc.kill("SIGTERM");
  });
}
