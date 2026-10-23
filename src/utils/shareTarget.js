// src/utils/shareTarget.js
// JS-side handle for android/app/src/main/java/com/katiso/upod/ShareTargetPlugin.java
// — see that file for the two arrival paths (cold start parks the URL for
// getPending(); a share into a running uPod fires the "shared" event).
//
// onSharedUrl() papers over that split so callers only deal with one
// thing: give it a handler, it fires once per share however the share
// got here, and returns an unsubscribe.
import { registerPlugin, Capacitor } from "@capacitor/core";

export const ShareTarget = registerPlugin("ShareTarget");

export function onSharedUrl(handler) {
  if (!Capacitor.isNativePlatform()) return () => {};

  let live = true;
  const deliver = (url) => {
    if (live && url) handler(url);
  };

  // The cold-start case: a share that launched the process has been
  // waiting in the plugin since before this code existed.
  ShareTarget.getPending()
    .then((res) => deliver(res?.url))
    .catch(() => {});

  const sub = ShareTarget.addListener("shared", (ev) => deliver(ev?.url));

  return () => {
    live = false;
    sub.then?.((s) => s.remove()) ?? sub.remove?.();
  };
}
