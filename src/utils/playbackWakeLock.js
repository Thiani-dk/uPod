// src/utils/playbackWakeLock.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/PlaybackWakeLockPlugin.java
// — see that file for why this exists. acquire()/release() only, no events.
import { registerPlugin } from "@capacitor/core";

export const PlaybackWakeLock = registerPlugin("PlaybackWakeLock");
