// src/shims/app.js
// Stands in for @capacitor/app.
//
// Three of the four events it exposes have a sensible desktop meaning;
// one deliberately does not:
//
//   backButton — Escape, and the mouse's back button. Both feed the same
//     handler stack the phone's gesture did, so modals close, then the
//     sidebar, then screens unwind, then the app quits.
//
//   resume — window focus. WelcomeOnboarding re-checks storage access on
//     resume, so this has to fire for that screen to settle.
//
//   pause — never emitted, on purpose. Its only consumer is the
//     background-playback watchdog, which exists to detect ColorOS
//     killing the app's process while it plays in the background. A
//     laptop doesn't do that, and a blurred window isn't a backgrounded
//     app. Emitting it would arm the watchdog on every click away and
//     greet the user with a "your phone killed uPod" warning that
//     describes settings their laptop doesn't have.
import { createEmitter } from "./emitter";

const bus = createEmitter();

// Back at the root of the app means "exit" on Android — the gesture is
// how you leave an app there. On a desktop it means nothing of the sort:
// a window closes from its own close button, and no desktop music player
// quits because you pressed Escape. The app's own back handler
// (App.jsx) calls exitApp() synchronously as its last resort, so
// dispatching the event inside this flag is enough to intercept exactly
// that case while leaving a deliberate "quit uPod" working.
let backDispatchDepth = 0;
function emitBack() {
  backDispatchDepth++;
  try {
    bus.emit("backButton", { canGoBack: true });
  } finally {
    backDispatchDepth--;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") emitBack();
  });

  // Mouse button 3 is "back" on most multi-button mice.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) {
      e.preventDefault();
      emitBack();
    }
  });

  window.addEventListener("focus", () => bus.emit("resume", {}));
}

export const App = {
  addListener: (event, handler) => bus.addListener(event, handler),
  removeAllListeners: bus.removeAllListeners,
  exitApp: async () => {
    if (backDispatchDepth > 0) return;
    await window.upodNative?.app?.exit();
  },
  getInfo: async () => ({ name: "uPod", id: "com.katiso.upod", build: "1", version: "1.0.0" }),
  getState: async () => ({ isActive: document.hasFocus() }),
  getLaunchUrl: async () => ({ url: "" }),
  minimizeApp: async () => {},
};

export default App;
