// src/utils/noisyAudio.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/NoisyAudioPlugin.java
// — a small native-only plugin owned by this app (not a published
// package), so it's registered directly rather than imported from
// node_modules like @capgo/capacitor-media-session is. Emits a "noisy"
// event whenever Android's ACTION_AUDIO_BECOMING_NOISY fires (most
// commonly: wired headphones unplugged).
import { registerPlugin } from "@capacitor/core";

export const NoisyAudio = registerPlugin("NoisyAudio");
