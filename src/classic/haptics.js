// src/classic/haptics.js
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

// A fast flick across the wheel can emit steps every few milliseconds.
// Firing a vibration per step at that rate doesn't produce more ticks —
// the motor can't keep up, and on Android the queued effects smear into
// one continuous buzz that feels like a fault rather than a wheel. This
// floor keeps each tick discrete; steps that fall inside the window still
// move the selection, they just don't get their own tick.
const MIN_GAP_MS = 28;

let lastTickAt = 0;
// Set once the plugin has thrown — if haptics aren't available on this
// device (or the user has system vibration off) every subsequent call
// would reject too, and a rejected promise per wheel step is noise.
let disabled = false;

// One wheel click. Deliberately fire-and-forget: nothing in the UI should
// wait on the motor, and a tick that fails is not worth telling anyone
// about.
export function classicTick() {
  if (disabled || !Capacitor.isNativePlatform()) return;
  const now = Date.now();
  if (now - lastTickAt < MIN_GAP_MS) return;
  lastTickAt = now;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
    disabled = true;
  });
}
