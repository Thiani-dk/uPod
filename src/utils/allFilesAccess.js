// src/utils/allFilesAccess.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/AllFilesAccessPlugin.java
// — see that file for why this exists. check() resolves { granted,
// applicable }; openSettings() deep-links to the exact right system
// settings screen for granting it.
import { registerPlugin } from "@capacitor/core";

export const AllFilesAccess = registerPlugin("AllFilesAccess");
