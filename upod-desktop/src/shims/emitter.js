// src/shims/emitter.js
// Capacitor's addListener contract in miniature: it resolves to a handle
// with remove(), and the app sometimes awaits that handle and sometimes
// calls .remove() straight on the returned value (see the
// `sub.then?.(...) ?? sub.remove?.()` pattern in shareTarget.js). A
// thenable that is also a handle satisfies both without the call sites
// changing.
export function listenerHandle(removeFn) {
  const remove = async () => {
    removeFn();
  };
  // What a thenable consumer receives. Deliberately a *different* object
  // from the handle below, and deliberately without a `then` of its own:
  // resolving a promise with a thenable makes the machinery call that
  // thenable's then(), so a thenable that resolves with itself recurses
  // forever. That cost the desktop port a 2GB renderer OOM a second or
  // two into every launch — the first `addListener(...).then(h => ...)`
  // call site (armBackgroundWatchdog) spun the microtask queue until V8
  // gave up, which looked like a hang rather than a bug in here.
  const resolved = { remove };
  const handle = { remove };
  // Thenable, so `await addListener(...)` yields a handle with remove().
  handle.then = (onFulfilled, onRejected) => Promise.resolve(resolved).then(onFulfilled, onRejected);
  return handle;
}

export function createEmitter() {
  const handlers = new Map();

  return {
    addListener(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return listenerHandle(() => handlers.get(event)?.delete(handler));
    },
    emit(event, payload) {
      for (const h of handlers.get(event) || []) {
        try {
          h(payload);
        } catch (err) {
          console.warn(`uPod desktop: listener for "${event}" threw`, err);
        }
      }
    },
    removeAllListeners() {
      handlers.clear();
      return Promise.resolve();
    },
  };
}

// Every shim bottoms out here. Failing loudly at import time beats a
// confusing "cannot read property of undefined" from deep inside the app.
export function native() {
  if (!globalThis.window?.upodNative) {
    throw new Error("uPod desktop bridge is missing — the preload script didn't run.");
  }
  return window.upodNative;
}
