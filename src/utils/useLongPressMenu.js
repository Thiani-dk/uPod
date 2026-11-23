// src/utils/useLongPressMenu.js
// Hold a track row to open its actions menu. The sibling of useBulkSelect:
// same hold duration, same slop, same swallow-the-trailing-click trick, so
// a hold feels identical whichever screen it lands on — one opens a menu,
// the other starts a selection.
//
// Only safe on rows where nothing else claims a hold. It is NOT used on
// the Tracks tab or Album detail, whose rows hold-to-select; those two
// reach the menu by tapping the row's own overflow button instead. See the
// gesture map in src/components/useTrackActions.jsx.
import { useCallback, useEffect, useRef } from "react";

// Kept in step with useBulkSelect's SELECT_HOLD_MS / SELECT_SLOP_PX on
// purpose: two different outcomes from the same-feeling gesture is fine,
// two different thresholds for the same-looking gesture is not.
const MENU_HOLD_MS = 450;
const MENU_SLOP_PX = 10;

export default function useLongPressMenu(onLongPress) {
  const pressRef = useRef({ timer: 0, x: 0, y: 0 });
  // The hold ends with a click on the row, which would play the track
  // behind the menu that just opened. This eats that one click. Cleared on
  // the next press rather than after the click, so a hold that ends
  // without one can't leave it armed.
  const swallowClickRef = useRef(false);
  const handlerRef = useRef(onLongPress);
  handlerRef.current = onLongPress;

  const cancelPress = useCallback(() => {
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = 0;
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  // Spread onto the row's own play/open button, wrapping whatever a tap
  // normally does.
  return useCallback((item, onActivate) => ({
    onClick: () => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      onActivate();
    },
    onPointerDown: (e) => {
      swallowClickRef.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const press = pressRef.current;
      press.x = e.clientX;
      press.y = e.clientY;
      clearTimeout(press.timer);
      press.timer = setTimeout(() => {
        press.timer = 0;
        swallowClickRef.current = true;
        handlerRef.current(item);
      }, MENU_HOLD_MS);
    },
    // Any real movement means this was a scroll, not a hold.
    onPointerMove: (e) => {
      const press = pressRef.current;
      if (!press.timer) return;
      if (Math.abs(e.clientX - press.x) > MENU_SLOP_PX || Math.abs(e.clientY - press.y) > MENU_SLOP_PX) {
        cancelPress();
      }
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    // A right-click or Android's own text-selection menu would otherwise
    // land on top of ours.
    onContextMenu: (e) => e.preventDefault(),
  }), [cancelPress]);
}
