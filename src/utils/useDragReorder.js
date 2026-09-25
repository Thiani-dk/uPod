// src/utils/useDragReorder.js
// The Queue modal's hold-and-drag reordering, lifted out of it verbatim so
// the playlist track list and the playlist list itself can use the exact
// same interaction rather than growing their own. Nothing about the
// behaviour changed in the move — QueueModal is still the reference
// implementation, it just no longer owns the code.
//
// The caller supplies the row count, the list's own CSS `gap`, and what to
// do with a finished drag; the hook hands back a ref for the scroll
// container, a ref callback for each row, the index currently lifted (for
// the caller's own lifted-row class), and the handlers the grip needs.
import { useCallback, useEffect, useRef, useState } from "react";

// A deliberate hold, not a hair trigger: the grip is small and sits at the
// edge of a scrollable list, so a drag that engaged on touch-down would
// fire on glancing contact during an ordinary scroll. Any movement past
// DRAG_SLOP before the hold completes cancels it and lets the list scroll
// as normal.
const LONG_PRESS_MS = 200;
const DRAG_SLOP_PX = 10;
// Dragging within this band of either end of the list scrolls it, so a
// row can be moved further than one screenful.
const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_PX_PER_FRAME = 12;

export default function useDragReorder({ count, gap = 0, onReorder }) {
  // Only the *identity* of the row being dragged lives in React state —
  // it's what drives the lifted-row class, and it changes twice per drag.
  // The positions themselves are written straight to the DOM below.
  const [draggingIndex, setDraggingIndex] = useState(null);

  const listRef = useRef(null);
  const rowRefs = useRef([]);
  const dragRef = useRef(null);
  const holdTimerRef = useRef(0);
  const scrollFrameRef = useRef(0);
  // onReorder is usually an inline arrow, so it must not be a dependency
  // of the memoised handlers below — the drag would restart mid-gesture.
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const gapRef = useRef(gap);
  gapRef.current = gap;

  // A shrinking list (a removed track, a reshuffle) would otherwise leave
  // stale element refs past the end, and the drag measures every ref it
  // finds.
  rowRefs.current.length = count;

  const setRowRef = useCallback((index) => (el) => { rowRefs.current[index] = el; }, []);

  // The list element is not always the thing that scrolls. In the Queue
  // modal it is (.queue-list has its own max-height and overflow), but a
  // list rendered straight into a screen scrolls with the whole content
  // column instead. Edge-scrolling has to nudge whichever of those two it
  // actually is, and measure its edges — nudging a non-scrolling element
  // silently does nothing, which is how a long playlist would end up
  // undraggable past one screenful.
  const resolveScroller = useCallback(() => {
    let el = listRef.current;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return listRef.current;
  }, []);

  // Every row back to its resting position, with no transition, so the
  // next render starts from a clean slate rather than animating from
  // wherever the drag left things.
  const clearRowTransforms = useCallback(() => {
    rowRefs.current.forEach((row) => {
      if (!row) return;
      row.style.transition = "";
      row.style.transform = "";
      row.style.opacity = "";
    });
  }, []);

  const stopEdgeScroll = useCallback(() => {
    if (scrollFrameRef.current) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
    }
  }, []);

  // Writes the whole list's positions for the current pointer offset:
  // the dragged row follows the finger, and every row it has passed over
  // steps one slot the other way to open up the gap it will land in.
  const applyDragPositions = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;
    const { from, rects } = drag;
    const dy = drag.pointerY - drag.startY;
    const step = rects[from].height + gapRef.current;
    const draggedCenter = rects[from].top + rects[from].height / 2 + dy;

    let target = from;
    for (let i = 0; i < rects.length; i++) {
      if (i === from) continue;
      const center = rects[i].top + rects[i].height / 2;
      if (i < from && draggedCenter < center) target = Math.min(target, i);
      if (i > from && draggedCenter > center) target = Math.max(target, i);
    }
    drag.target = target;

    rowRefs.current.forEach((row, i) => {
      if (!row) return;
      if (i === from) {
        row.style.transition = "none";
        row.style.transform = `translate3d(0, ${dy}px, 0) scale(1.03)`;
        row.style.opacity = "0.96";
        return;
      }
      let shift = 0;
      if (target > from && i > from && i <= target) shift = -step;
      else if (target < from && i >= target && i < from) shift = step;
      row.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
      row.style.opacity = "";
    });
  }, []);

  // Re-measures after each scroll step: the rects were taken in viewport
  // coordinates, so scrolling the list invalidates them.
  const runEdgeScroll = useCallback(() => {
    scrollFrameRef.current = 0;
    const drag = dragRef.current;
    const list = resolveScroller();
    if (!drag || !drag.active || !list) return;

    const bounds = list.getBoundingClientRect();
    let delta = 0;
    if (drag.pointerY < bounds.top + EDGE_SCROLL_ZONE_PX) {
      delta = -Math.min(EDGE_SCROLL_MAX_PX_PER_FRAME, (bounds.top + EDGE_SCROLL_ZONE_PX - drag.pointerY) / 3);
    } else if (drag.pointerY > bounds.bottom - EDGE_SCROLL_ZONE_PX) {
      delta = Math.min(EDGE_SCROLL_MAX_PX_PER_FRAME, (drag.pointerY - (bounds.bottom - EDGE_SCROLL_ZONE_PX)) / 3);
    }
    if (!delta) return;

    const before = list.scrollTop;
    list.scrollTop = before + delta;
    const moved = list.scrollTop - before;
    if (!moved) return;
    // The list moved under the finger, so every cached rect and the
    // drag's own origin shift by exactly that much.
    drag.rects = drag.rects.map((r) => ({ top: r.top - moved, height: r.height }));
    drag.startY -= moved;
    applyDragPositions();
    scrollFrameRef.current = requestAnimationFrame(runEdgeScroll);
  }, [applyDragPositions, resolveScroller]);

  const cancelHold = useCallback(() => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = 0;
  }, []);

  const onPointerDown = useCallback((index, e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const handle = e.currentTarget;
    dragRef.current = {
      from: index,
      target: index,
      startY: e.clientY,
      pointerY: e.clientY,
      startX: e.clientX,
      pointerId: e.pointerId,
      active: false,
      rects: [],
    };
    cancelHold();
    holdTimerRef.current = setTimeout(() => {
      const drag = dragRef.current;
      if (!drag) return;
      // Measured at the moment the drag engages, not at pointerdown —
      // the list may have been scrolling right up until the hold landed.
      drag.rects = rowRefs.current.map((row) => {
        const rect = row ? row.getBoundingClientRect() : { top: 0, height: 0 };
        return { top: rect.top, height: rect.height };
      });
      drag.active = true;
      try { handle.setPointerCapture(drag.pointerId); } catch { /* not all targets support capture */ }
      setDraggingIndex(index);
      applyDragPositions();
    }, LONG_PRESS_MS);
  }, [applyDragPositions, cancelHold]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.pointerY = e.clientY;
    if (!drag.active) {
      // Still waiting on the hold — any real movement means this was a
      // scroll, not a reorder.
      if (Math.abs(e.clientY - drag.startY) > DRAG_SLOP_PX || Math.abs(e.clientX - drag.startX) > DRAG_SLOP_PX) {
        cancelHold();
        dragRef.current = null;
      }
      return;
    }
    applyDragPositions();
    if (!scrollFrameRef.current) scrollFrameRef.current = requestAnimationFrame(runEdgeScroll);
  }, [applyDragPositions, cancelHold, runEdgeScroll]);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    cancelHold();
    stopEdgeScroll();
    if (!drag || !drag.active) return;
    // Clear the transforms first: the reorder re-renders the list in the
    // new order, and a row still carrying a translate would land one slot
    // off from where it actually belongs.
    clearRowTransforms();
    setDraggingIndex(null);
    if (drag.target !== drag.from) onReorderRef.current(drag.from, drag.target);
  }, [cancelHold, clearRowTransforms, stopEdgeScroll]);

  useEffect(() => () => {
    cancelHold();
    stopEdgeScroll();
  }, [cancelHold, stopEdgeScroll]);

  // Spread onto the grip button. Everything the handle needs and nothing
  // the row needs — the rest of the row stays an ordinary tap target.
  const gripProps = useCallback((index) => ({
    onPointerDown: (e) => onPointerDown(index, e),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onContextMenu: (e) => e.preventDefault(),
  }), [onPointerDown, onPointerMove, onPointerUp]);

  return { draggingIndex, listRef, setRowRef, gripProps };
}
