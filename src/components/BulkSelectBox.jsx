// src/components/BulkSelectBox.jsx
// The checkbox a row shows while selection mode is on. Each screen drops
// it into whatever slot that row can spare — the artwork thumbnail in the
// Tracks tab, the track number in Album detail — so rows don't reflow on
// the way in and out of the mode.
import React from "react";
import { Check } from "lucide-react";

export default function BulkSelectBox({ checked }) {
  return (
    <div className={`track-select-box${checked ? " checked" : ""}`}>
      {checked && <Check size={13} strokeWidth={3} />}
    </div>
  );
}
