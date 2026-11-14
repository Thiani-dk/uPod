// src/desktop-keys.js
// Keyboard control for the desktop build.
//
// Design rules, taken from what people actually complain about in
// Spotify's desktop client:
//
//   * Nothing is grabbed globally. These are ordinary listeners on the
//     app's own window, so uPod cannot eat a keystroke meant for
//     another app — the single exception is the Ctrl+Alt+U share
//     shortcut, which is registered with the desktop environment on
//     purpose and does one explicit thing. The common grievance is a
//     player intercepting Backspace or Ctrl while you work elsewhere.
//
//   * Typing always wins. Every binding bails out inside an input,
//     textarea or contenteditable, so Space in the search box is a
//     space, not a pause. Bare letters are only bound where that holds.
//
//   * Nothing destructive on a bare key. The bare keys here are
//     transport and volume: wrong guesses are instantly undoable.
//
//   * They are discoverable. "?" opens the full list, because a
//     shortcut nobody can find is a feature nobody has.
//
// Everything routes through the same handlers the media keys and the
// desktop's own media controls use, so there is one implementation of
// "next track" rather than three.
import { triggerMediaAction, isMediaPlaying } from "./shims/media-session";

// --- the audio element ------------------------------------------------------
// PlayerContext builds its <audio> with `new Audio()` and keeps it in a
// ref, so it never enters the DOM and querySelector can't reach it.
// Patching the constructor before the app's first render is the one hook
// that does, and it is read-only here apart from volume and seeking —
// both of which are exactly what the element is for.
let audioEl = null;
if (typeof window !== "undefined" && typeof window.Audio === "function") {
  const NativeAudio = window.Audio;
  window.Audio = function PatchedAudio(...args) {
    const el = new NativeAudio(...args);
    audioEl = el;
    return el;
  };
  window.Audio.prototype = NativeAudio.prototype;
}

const SEEK_SMALL = 5;
const SEEK_LARGE = 30;
const VOLUME_STEP = 0.05;

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable === true
  );
}

function seekBy(seconds) {
  const el = audioEl;
  if (!el || !Number.isFinite(el.duration)) return false;
  const next = Math.min(Math.max(el.currentTime + seconds, 0), el.duration);
  // Through the app's own seek handler where it has one, so its position
  // state and the desktop's media controls stay in step; straight to the
  // element otherwise.
  if (!triggerMediaAction("seekto", { seekTime: next })) el.currentTime = next;
  toast(`${formatTime(next)} / ${formatTime(el.duration)}`);
  return true;
}

function nudgeVolume(delta) {
  const el = audioEl;
  if (!el) return false;
  el.muted = false;
  el.volume = Math.min(Math.max(el.volume + delta, 0), 1);
  toast(`Volume ${Math.round(el.volume * 100)}%`);
  return true;
}

function toggleMute() {
  const el = audioEl;
  if (!el) return false;
  el.muted = !el.muted;
  toast(el.muted ? "Muted" : `Volume ${Math.round(el.volume * 100)}%`);
  return true;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// --- reaching the app's own controls ----------------------------------------
// Screens and the sidebar live in React state this file has no handle on,
// so those bindings click the real control the user would have clicked.
// Matched on the visible label: the sidebar is always rendered (the
// drawer is a CSS width, not a mount), so this works whether it is open,
// closed or docked.
function clickNav(label) {
  const items = document.querySelectorAll(".sidebar .nav-item");
  for (const item of items) {
    if (item.textContent.trim().toLowerCase() === label.toLowerCase()) {
      item.click();
      return true;
    }
  }
  return false;
}

function focusSearch() {
  const input = document.querySelector('.content input[type="search"], .content input[placeholder*="earch"]');
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}

function toggleSidebar() {
  // Docked by the layout on a wide window — nothing to toggle, and
  // pretending otherwise would hide the nav behind a shortcut.
  if (window.matchMedia("(min-width: 860px)").matches) return false;
  const open = document.querySelector(".sidebar.open");
  if (open) {
    document.querySelector(".scrim.show")?.click();
    return true;
  }
  const menu = document.querySelector(".topbar .icon-btn");
  if (!menu) return false;
  menu.click();
  return true;
}

// --- mini mode --------------------------------------------------------------
async function toggleCompact() {
  const native = window.upodNative?.win;
  if (!native) return false;
  const { compact } = await native.getCompact();
  if (!compact && !document.querySelector(".mini-player")) {
    toast("Mini player needs something playing");
    return true;
  }
  await native.setCompact(!compact);
  return true;
}

// --- feedback ---------------------------------------------------------------
// Volume and seek have no on-screen control of their own on a phone
// layout, so without this they are silent guesses.
let toastEl = null;
let toastTimer = null;
function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "desktop-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1100);
}

// --- the shortcut sheet -----------------------------------------------------
const SHORTCUTS = [
  ["Playback", [
    ["Space", "Play / pause"],
    ["N / P", "Next / previous track"],
    ["← / →", `Seek ${SEEK_SMALL}s`],
    ["Shift + ← / →", `Seek ${SEEK_LARGE}s`],
    ["↑ / ↓", "Volume"],
    ["M", "Mute"],
  ]],
  ["Getting around", [
    ["/", "Search your library"],
    ["Ctrl + 1 … 6", "Now Playing, Library, Studio, Karaoke, Equalizer, Settings"],
    ["Ctrl + B", "Show / hide the menu (narrow windows)"],
    ["Esc", "Back — closes a sheet, then the menu, then up a screen"],
  ]],
  ["Window", [
    ["Ctrl + Shift + M", "Mini player — a small always-on-top bar"],
    ["F11", "Full screen"],
    ["Ctrl + Alt + U", "Download the link on your clipboard (works from any app)"],
    ["?", "This list"],
  ]],
];

let sheetEl = null;
function toggleSheet(force) {
  if (!sheetEl) {
    sheetEl = document.createElement("div");
    sheetEl.className = "desktop-sheet";
    sheetEl.innerHTML = `
      <div class="desktop-sheet-card" role="dialog" aria-label="Keyboard shortcuts">
        <div class="desktop-sheet-head">
          <h2>Keyboard shortcuts</h2>
          <button class="desktop-sheet-close" aria-label="Close">✕</button>
        </div>
        <div class="desktop-sheet-cols">
          ${SHORTCUTS.map(
            ([group, rows]) => `
            <section>
              <h3>${group}</h3>
              ${rows.map(([key, what]) => `<div class="desktop-sheet-row"><kbd>${key}</kbd><span>${what}</span></div>`).join("")}
            </section>`
          ).join("")}
        </div>
      </div>`;
    sheetEl.addEventListener("click", (e) => {
      if (e.target === sheetEl || e.target.closest(".desktop-sheet-close")) toggleSheet(false);
    });
    document.body.appendChild(sheetEl);
  }
  const show = force === undefined ? !sheetEl.classList.contains("show") : force;
  sheetEl.classList.toggle("show", show);
  return true;
}

// --- bindings ---------------------------------------------------------------
function handleKey(e) {
  if (e.defaultPrevented) return;

  // Esc closes this sheet before the app's own back handling sees it.
  if (e.key === "Escape" && sheetEl?.classList.contains("show")) {
    toggleSheet(false);
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (isTyping(e.target)) return;

  const ctrl = e.ctrlKey || e.metaKey;
  let handled = false;

  if (ctrl && !e.shiftKey && !e.altKey) {
    const navByNumber = {
      1: "Now Playing",
      2: "Library",
      3: "Studio",
      4: "Karaoke",
      5: "Equalizer",
      6: "Settings",
    };
    if (navByNumber[e.key]) handled = clickNav(navByNumber[e.key]);
    else if (e.key.toLowerCase() === "b") handled = toggleSidebar();
    else if (e.key.toLowerCase() === "f") handled = focusSearch();
  } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "m") {
    toggleCompact();
    handled = true;
  } else if (!ctrl && !e.altKey) {
    switch (e.key) {
      case " ":
        handled = triggerMediaAction("playpause");
        break;
      case "ArrowRight":
        handled = seekBy(e.shiftKey ? SEEK_LARGE : SEEK_SMALL);
        break;
      case "ArrowLeft":
        handled = seekBy(-(e.shiftKey ? SEEK_LARGE : SEEK_SMALL));
        break;
      case "ArrowUp":
        handled = nudgeVolume(VOLUME_STEP);
        break;
      case "ArrowDown":
        handled = nudgeVolume(-VOLUME_STEP);
        break;
      case "n":
      case "N":
        handled = triggerMediaAction("next");
        break;
      case "p":
      case "P":
        handled = triggerMediaAction("previous");
        break;
      case "m":
      case "M":
        handled = toggleMute();
        break;
      case "/":
        handled = focusSearch();
        break;
      case "?":
        handled = toggleSheet();
        break;
      case "F11":
        window.upodNative?.win?.toggleFullScreen();
        handled = true;
        break;
      default:
        break;
    }
  }

  if (handled) {
    e.preventDefault();
    // Not stopPropagation: the app's own Escape/back handling and any
    // React listeners are entitled to see keys this didn't claim.
  }
}

// A shortcut nobody can find is a feature nobody has — the single most
// repeated complaint about Spotify's desktop client is hidden behaviour
// with no on-screen affordance. So the sheet has a permanent way in that
// doesn't need the keyboard. Deliberately a fixed-position element of its
// own rather than a child of .topbar: that subtree belongs to React, and
// nothing here should be in a position to confuse its reconciliation.
function installHelpButton() {
  const btn = document.createElement("button");
  btn.className = "desktop-help-btn";
  btn.type = "button";
  btn.textContent = "?";
  btn.title = "Keyboard shortcuts (?)";
  btn.setAttribute("aria-label", "Keyboard shortcuts");
  btn.addEventListener("click", () => toggleSheet(true));
  document.body.appendChild(btn);
}

export function installDesktopKeys() {
  if (typeof window === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installHelpButton, { once: true });
  } else {
    installHelpButton();
  }
  // Capture phase, so a focused button doesn't swallow Space as a click
  // before the transport sees it. isTyping() above is what keeps this
  // honest inside text fields.
  window.addEventListener("keydown", handleKey, true);

  // The layout follows the window, so the class is only for anything
  // that needs to *know* (currently: nothing in CSS, everything in
  // behaviour) — and for the mini bar's own "back to full size" button.
  window.upodNative?.win?.onCompactChange(({ compact }) => {
    document.documentElement.classList.toggle("upod-compact", !!compact);
  });

  // Click-to-restore from the mini bar: the whole point is a window with
  // no room for chrome, so the bar's art doubles as the way back.
  document.addEventListener("dblclick", (e) => {
    if (!document.documentElement.classList.contains("upod-compact")) return;
    if (e.target.closest(".mini-play, .mini-dismiss")) return;
    window.upodNative?.win?.setCompact(false);
  });
}

export { isMediaPlaying };
