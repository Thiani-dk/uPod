// src/utils/backgroundPlaybackWatchdog.js
// Detects one specific failure mode: OPPO/ColorOS's aggressive
// background-process management (encountered directly during development
// — see the "Oplus Hans" LcdOff freeze that repeatedly paused this app's
// scan mid-flight while the screen was off) can kill this app's whole
// process while backgrounded, not just pause it the way a phone call or
// headphone unplug does. There's no public Android API a WebView app can
// call to ask "is background app restriction currently enabled for me?",
// so this is a heuristic: if playback was active when the app went to
// background, and the *next* thing that happens is a cold launch rather
// than a normal resume, the process was killed mid-playback — a resume
// would have cleared the marker below.
import { Preferences } from "@capacitor/preferences";
import { App as CapacitorApp } from "@capacitor/app";

const MARKER_KEY = "upod_bg_playback_marker";
// Older than this, treat the marker as stale (e.g. the phone sat off
// overnight) rather than a same-session kill worth nagging about.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// Call once on launch. `isPlayingRef` must always hold the latest
// state.playing (a ref, not the value itself, since this only runs once
// but needs to read current state on every future pause event). Returns a
// cleanup function.
export function armBackgroundWatchdog(isPlayingRef) {
  const handles = [];
  CapacitorApp.addListener("pause", () => {
    if (isPlayingRef.current) {
      Preferences.set({ key: MARKER_KEY, value: String(Date.now()) });
    }
  }).then((h) => handles.push(h));
  CapacitorApp.addListener("resume", () => {
    // Reaching a real 'resume' event means the process survived —
    // whatever paused playback (if anything) was a normal OS event
    // already reflected correctly via state.playing, not a kill. Clear
    // the marker so it doesn't get misattributed if the process is
    // killed some other time later.
    Preferences.remove({ key: MARKER_KEY });
  }).then((h) => handles.push(h));
  return () => handles.forEach((h) => h.remove());
}

// Call once on cold launch, before arming the watchdog above. Resolves
// true if the previous session left the marker dangling (backgrounded
// while playing, never followed by a resume) — i.e. the process was
// killed rather than merely paused. Always clears the marker, so a given
// incident is only ever reported once.
export async function checkAndClearBackgroundKillMarker() {
  const { value } = await Preferences.get({ key: MARKER_KEY });
  if (!value) return false;
  await Preferences.remove({ key: MARKER_KEY });
  const age = Date.now() - Number(value);
  return age >= 0 && age < STALE_AFTER_MS;
}

// Exact, on-device-confirmed path (Android 14 / ColorOS, OPPO CPH2409):
// Settings → Apps → uPod → Battery usage → "Allow background activity".
// The system-wide auto-launch manager's exact wording varies more by
// ColorOS version/region, so it's phrased a bit more generally.
export const BACKGROUND_PLAYBACK_GUIDANCE = {
  primary: 'Settings → Apps → uPod → Battery usage → turn on "Allow background activity".',
  secondary:
    'Also worth checking: Settings → App Management → Auto Launch (or your Phone Manager app\'s Startup Manager) — make sure uPod is allowed to start automatically.',
};
