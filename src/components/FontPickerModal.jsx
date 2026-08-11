// src/components/FontPickerModal.jsx
import React from "react";
import { X, Check } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { FONT_OPTIONS } from "../utils/fonts";

export default function FontPickerModal({ onClose }) {
  const { fontFamily } = usePlayerState();
  const { setFontFamily } = usePlayerActions();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet font-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Select Typeface</h3>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="font-picker-list">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              className="font-picker-row"
              style={{ fontFamily: f.stack }}
              onClick={() => {
                setFontFamily(f.id);
                onClose();
              }}
            >
              <span>{f.label}</span>
              <span className={`font-picker-radio ${fontFamily === f.id ? "font-picker-radio-active" : ""}`}>
                {fontFamily === f.id && <Check size={12} />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
