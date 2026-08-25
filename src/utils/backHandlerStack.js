// src/utils/backHandlerStack.js
// A single LIFO stack shared by every modal/sheet in the app, so one
// hardware/gesture back-button listener (registered once in App.jsx) can
// close whichever one is currently on top without each modal needing its
// own native listener (which would have no way to avoid also triggering
// screen-level back navigation on the same press).
const stack = [];

// Registers `handler` on top of the stack; returns an unregister function
// for the caller's effect cleanup. Safe to call multiple times for the
// same conceptual handler (e.g. StrictMode double-invoke) — each push gets
// its own matching removal.
export function pushBackHandler(handler) {
  stack.push(handler);
  return () => {
    const idx = stack.lastIndexOf(handler);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

// Invokes and implicitly lets the topmost handler's own cleanup pop it
// (handlers close their modal, which unmounts it, which runs the effect
// cleanup from pushBackHandler). Returns true if something was open and
// handled the press, false if the stack was empty.
export function consumeTopBackHandler() {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}
