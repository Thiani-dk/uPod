// src/shims/media-session.js
// Stands in for @capgo/capacitor-media-session.
//
// That plugin existed because a plain Android WebView doesn't implement
// the native half of the Media Session API, so the web-standard
// navigator.mediaSession did nothing there. Electron is Chromium, where
// that API is real — so the shim is mostly a thin adapter from the
// plugin's promise-returning calls onto the standard object, and the
// lock-screen controls become the desktop's own media controls.
//
// The hardware media keys are the one gap: Chromium only receives them
// when it owns them at the OS level, which an Electron app doesn't. The
// main process registers them as global shortcuts instead and forwards
// them here, so they reach the same handlers.
const handlers = new Map();

function mediaSession() {
  return typeof navigator !== "undefined" ? navigator.mediaSession : null;
}

// The app's own transport, by name. Both the hardware media keys and the
// desktop keyboard shortcuts (src/desktop-keys.js) come through here, so
// a shortcut does exactly what the lock-screen control does — no second
// implementation of "next track" to drift out of step.
export function triggerMediaAction(action, details) {
  const map = {
    next: "nexttrack",
    previous: "previoustrack",
    stop: "pause",
  };
  const target = action === "playpause" ? (isPlaying() ? "pause" : "play") : map[action] || action;
  const handler = handlers.get(target);
  if (!handler) return false;
  handler(details);
  return true;
}

export function isMediaPlaying() {
  return isPlaying();
}

if (typeof window !== "undefined") {
  window.upodNative?.media?.onKey(({ action }) => triggerMediaAction(action));
}

let playbackState = "none";
function isPlaying() {
  return playbackState === "playing";
}

export const MediaSession = {
  setActionHandler: async ({ action }, handler) => {
    if (handler) handlers.set(action, handler);
    else handlers.delete(action);
    const ms = mediaSession();
    if (!ms) return;
    try {
      ms.setActionHandler(action, handler ? (details) => handler(details) : null);
    } catch {
      // Chromium rejects handlers for actions it doesn't know; the
      // global-shortcut path above still covers those.
    }
  },

  setPlaybackState: async ({ playbackState: state }) => {
    playbackState = state || "none";
    const ms = mediaSession();
    if (ms) ms.playbackState = playbackState;
  },

  setMetadata: async ({ title, artist, album, artwork }) => {
    const ms = mediaSession();
    if (!ms || typeof MediaMetadata === "undefined") return;
    ms.metadata = new MediaMetadata({
      title: title || "",
      artist: artist || "",
      album: album || "",
      artwork: artwork || [],
    });
  },

  setPositionState: async ({ duration, position, playbackRate }) => {
    const ms = mediaSession();
    if (!ms?.setPositionState) return;
    try {
      // Chromium throws if position exceeds duration, which can happen
      // for a beat at track end; clamping keeps a harmless rounding
      // artefact from becoming a console error on every track change.
      const d = Number(duration) || 0;
      ms.setPositionState({
        duration: d,
        position: Math.min(Math.max(Number(position) || 0, 0), d),
        playbackRate: Number(playbackRate) || 1,
      });
    } catch {
      /* non-finite duration mid-load */
    }
  },
};

export default MediaSession;
