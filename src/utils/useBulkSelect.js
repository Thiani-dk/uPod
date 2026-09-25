// src/utils/useBulkSelect.js
// Long-press-to-select, built for the Tracks tab and lifted out of it so
// Album detail runs the same one rather than a lookalike. The screen owns
// what a row looks like; this owns what the gesture and the selection
// mean, and BulkActionBar owns what's done with the result.
//
// Safe to put on a row only where nothing else claims a hold on that row.
// PlaylistDetail deliberately doesn't use it: its rows carry a drag handle
// for reordering, and two hold-gestures on one row fight each other.
import { useCallback, useEffect, useRef, useState } from "react";

// Mirrors the hold/slop contract the drag handles use (see useDragReorder)
// so the two gestures feel like the same app — longer here, because this
// one arms on the whole row rather than a small dedicated handle.
const SELECT_HOLD_MS = 450;
const SELECT_SLOP_PX = 10;

export default function useBulkSelect() {
  // null means the mode is off entirely — an empty Set would still show
  // the action bar, and "0 selected" hovering over the library is not a
  // state worth having. A long-press on any row turns it on with that row
  // already selected.
  const [selectedIds, setSelectedIds] = useState(null);
  const pressRef = useRef({ timer: 0, x: 0, y: 0 });
  // Lifting the finger after a hold still produces a click, and by then
  // the mode is already on — so that click would land on the toggle and
  // switch straight back off the row the hold just selected, taking the
  // whole mode with it. This eats exactly that one click. Cleared at the
  // start of the next press rather than after the click, so a hold that
  // ends without one (finger dragged off the row) can't leave it armed.
  const swallowClickRef = useRef(false);
  // The click handler below is built once per render but read by an event
  // that fires later; this keeps it from deciding against a stale mode.
  const selectingRef = useRef(false);
  selectingRef.current = selectedIds !== null;

  const cancelPress = useCallback(() => {
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = 0;
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  const toggleSelected = useCallback((trackId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      // Deselecting the last one leaves the mode, rather than stranding an
      // empty action bar the user then has to dismiss separately.
      return next.size === 0 ? null : next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(null), []);

  const selecting = selectedIds !== null;

  // Spread onto the row's own play/open button. `onActivate` is whatever
  // that row normally does when tapped — it keeps doing it until the mode
  // is on, at which point a plain tap toggles instead, which is the only
  // way to pick the second, third, fourth track without holding each one.
  const rowProps = useCallback((trackId, onActivate) => ({
    onClick: () => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      if (selectingRef.current) toggleSelected(trackId);
      else onActivate();
    },
    onPointerDown: (e) => {
      swallowClickRef.current = false;
      // Once the mode is on there is nothing left to arm — tapping is
      // enough — so the hold only runs on the way in.
      if (selectingRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const press = pressRef.current;
      press.x = e.clientX;
      press.y = e.clientY;
      clearTimeout(press.timer);
      press.timer = setTimeout(() => {
        press.timer = 0;
        swallowClickRef.current = true;
        setSelectedIds((prev) => new Set(prev || []).add(trackId));
      }, SELECT_HOLD_MS);
    },
    // Any real movement means this was a scroll, not a selection.
    onPointerMove: (e) => {
      const press = pressRef.current;
      if (!press.timer) return;
      if (Math.abs(e.clientX - press.x) > SELECT_SLOP_PX || Math.abs(e.clientY - press.y) > SELECT_SLOP_PX) {
        cancelPress();
      }
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onContextMenu: (e) => e.preventDefault(),
  }), [cancelPress, toggleSelected]);

  return { selectedIds, selecting, toggleSelected, clearSelection, rowProps };
}
