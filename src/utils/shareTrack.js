// src/utils/shareTrack.js
// "Share" hands out what uPod actually knows about a track — title, artist,
// album — as text. Not the file: the library is local files the app reads
// but doesn't own, and @capacitor/share isn't installed, so attaching the
// audio would mean a new native dependency for a menu row.
//
// Two paths, in order of how good the result is:
//   1. navigator.share — the real system sheet. Present in the Android
//      WebView (Capacitor serves over https://localhost, a secure
//      context), absent in Electron.
//   2. the clipboard — what's left on desktop. Still a share, just one
//      the user pastes themselves. Three goes at it, because the two
//      in-page routes both need the document focused and throw
//      NotAllowedError when it isn't (seen in Electron): the host's own
//      clipboard if it offers one (the desktop port does, via
//      window.upodNative.share — feature-detected, so Android never
//      looks for it), then the async Clipboard API, then the old
//      execCommand("copy") on a throwaway textarea.
// If none of those exist the menu hides the row rather than offering a
// button that does nothing (see canShareTrack).

export function trackShareText(track) {
  const bits = [track.title || "Unknown track"];
  if (track.artist) bits.push(track.artist);
  if (track.album && track.album !== track.artist) bits.push(track.album);
  return bits.join(" — ");
}

function hostClipboard() {
  return typeof window !== "undefined" ? window.upodNative?.share?.copyText : undefined;
}

export function canShareTrack() {
  if (typeof navigator === "undefined") return false;
  // execCommand("copy") is available wherever there's a document, which
  // is why this is effectively always true in the app — the row is still
  // gated rather than unconditional so a stripped-down host (a test
  // renderer, a future embed) doesn't show a dead button.
  return Boolean(navigator.share) || Boolean(navigator.clipboard?.writeText) || typeof document !== "undefined";
}

// Pre-Clipboard-API copy. Needs a selection inside a focused, visible
// element, so the textarea is positioned off-view rather than hidden —
// display:none or visibility:hidden can't be selected.
function copyViaExecCommand(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0;";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

// Resolves to a short line to show the user, or null when the share sheet
// was simply dismissed (which is not a failure and deserves no toast).
export async function shareTrack(track) {
  const text = trackShareText(track);
  if (navigator.share) {
    try {
      await navigator.share({ title: track.title || "Track", text });
      return null;
    } catch (err) {
      // AbortError is the user closing the sheet. Anything else falls
      // through to the clipboard rather than failing outright.
      if (err?.name === "AbortError") return null;
    }
  }
  const hostCopy = hostClipboard();
  if (hostCopy) {
    try {
      await hostCopy({ text });
      return "Track details copied";
    } catch {
      /* fall through to the in-page routes */
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "Track details copied";
    } catch {
      /* unfocused document, or no clipboard-write permission */
    }
  }
  if (copyViaExecCommand(text)) return "Track details copied";
  return "Couldn't share this track";
}
