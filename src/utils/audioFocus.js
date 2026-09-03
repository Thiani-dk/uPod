// src/utils/audioFocus.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/AudioFocusPlugin.java
// — a small native-only plugin owned by this app (not a published
// package), registered directly like NoisyAudio. Exposes requestFocus()/
// abandonFocus() and a "focuschange" event carrying { type: "loss" |
// "lossTransient" | "duck" | "gain" }.
import { registerPlugin } from "@capacitor/core";

export const AudioFocus = registerPlugin("AudioFocus");
