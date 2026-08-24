// src/components/SleepTimerModal.jsx
import React, { useEffect, useState } from "react";
import { X, Moon } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";

const DURATIONS = [15, 30, 45, 60, 90];

function formatRemaining(endsAt) {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "less than a minute";
  const mins = Math.ceil(ms / 60000);
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

export default function SleepTimerModal({ onClose }) {
  useBackButtonClose(onClose);
  const { sleepTimerEndsAt } = usePlayerState();
  const { setSleepTimer, cancelSleepTimer } = usePlayerActions();
  // Local-only ticking display of remaining time — deliberately not stored
  // in the global reducer (see PlayerContext's currentTime/duration split)
  // so this modal re-renders on its own timer instead of the whole app.
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    const t = setInterval(() => forceTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [sleepTimerEndsAt]);

  function pick(minutes) {
    setSleepTimer(minutes);
    onClose();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Sleep Timer</div>
          <button className="icon-btn small" onClick={onClose} aria-label="Close sleep timer">
            <X size={16} />
          </button>
        </div>

        {sleepTimerEndsAt ? (
          <>
            <div className="settings-row-sub" style={{ marginBottom: 16 }}>
              <Moon size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              Playback pauses in {formatRemaining(sleepTimerEndsAt)}.
            </div>
            <button className="pill-btn" onClick={() => { cancelSleepTimer(); onClose(); }}>
              Cancel timer
            </button>
            <div className="settings-group-title" style={{ marginTop: 20 }}>Change duration</div>
          </>
        ) : (
          <div className="settings-row-sub" style={{ marginBottom: 16 }}>
            Pause playback automatically after a set time.
          </div>
        )}

        <div className="instant-mix-chip-row">
          {DURATIONS.map((m) => (
            <button key={m} className="chip" onClick={() => pick(m)}>
              {m} min
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
