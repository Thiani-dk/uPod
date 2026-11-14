// src/entry.jsx
// The desktop entry point. It deliberately does nothing but pull in the
// phone app's own main.jsx — the shims are wired by Vite aliases, so by
// the time App.jsx runs, every @capacitor/* import has already resolved
// to its desktop counterpart.
import "./desktop.css";
import { installDesktopKeys } from "./desktop-keys";

// Before the app renders: desktop-keys patches window.Audio to get a
// handle on the element PlayerContext builds during its first render,
// which is what volume and seeking act on.
installDesktopKeys();

import("@app/main.jsx");
