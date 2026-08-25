// src/utils/useBackButtonClose.js
import { useEffect, useRef } from "react";
import { pushBackHandler } from "./backHandlerStack";

// Makes the hardware/gesture back button close this modal instead of
// falling through to screen navigation or exiting the app. Call
// unconditionally from a modal component that's only ever mounted while
// open (the existing pattern throughout this app, e.g.
// `{queueOpen && <QueueModal onClose={...} />}`) — registers once on
// mount, always invokes whatever `onClose` currently is.
export default function useBackButtonClose(onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => pushBackHandler(() => onCloseRef.current()), []);
}
