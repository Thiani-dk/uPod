// src/screens/EqScreen.jsx
import React from "react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { EQ_FREQUENCIES, EQ_PRESETS } from "../audio/engine";

function formatFreqLabel(hz) {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}K` : `${hz}`;
}

export default function EqScreen() {
  const { eqBands, eqPreset, queue, queueIndex } = usePlayerState();
  const { setEqBand, setEqPreset } = usePlayerActions();
  const hasAudio = Boolean(queue[queueIndex]);
  const presetNames = [...Object.keys(EQ_PRESETS), "Custom"];

  return (
    <div className="eq-screen">
      {!hasAudio && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          The EQ applies to whatever plays next — start a track to hear changes live.
        </div>
      )}

      <div className="eq-preset-row">
        {presetNames.map((name) => (
          <button
            key={name}
            className={`chip ${eqPreset === name ? "chip-active" : ""}`}
            disabled={name === "Custom"}
            onClick={() => setEqPreset(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="eq-bands">
        {EQ_FREQUENCIES.map((freq, i) => (
          <div key={freq} className="eq-band">
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={eqBands[i]}
              orient="vertical"
              className="eq-slider"
              onChange={(e) => setEqBand(i, Number(e.target.value))}
            />
            <div className="eq-band-label">{formatFreqLabel(freq)}</div>
          </div>
        ))}
      </div>

      <div className="settings-row-sub" style={{ textAlign: "center" }}>
        Bands are real BiquadFilterNodes — the sound actually changes as you drag.
      </div>
    </div>
  );
}
