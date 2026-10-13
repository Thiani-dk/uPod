// src/components/ResumePromptModal.jsx
// Shown on coming back to uPod after a long absence with a track still
// loaded and paused (see RESUME_PROMPT_AFTER_MS in PlayerContext). The
// whole point is that it is a question and not an action: half an hour
// later, neither starting the music on its own nor saying nothing at all
// is the right thing to do.
import React from "react";
import { Play, X } from "lucide-react";
import { usePlayerActions } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function ResumePromptModal({ prompt }) {
  const { play, dismissResumePrompt, declineResume } = usePlayerActions();
  // Every way out of this dialog except Resume is a decline, including
  // the backdrop and the hardware back button. Half an hour later the
  // queue isn't something the user is holding on to, and leaving it
  // loaded after they've waved the question away is exactly the state
  // this whole prompt exists to avoid.
  useBackButtonClose(declineResume);

  function handleResume() {
    dismissResumePrompt();
    play();
  }

  return (
    <div className="modal-scrim" onClick={declineResume}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Resume music?</div>
          <button className="icon-btn small" onClick={declineResume} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>

        <div className="settings-row-sub">
          You left off part-way through "{prompt.title}"
          {prompt.artist ? ` by ${prompt.artist}` : ""}. Pick it back up where it stopped?
        </div>

        <div className="modal-actions">
          <button className="ghost-btn" onClick={declineResume}>Not now</button>
          <button className="primary-btn" onClick={handleResume}>
            <Play size={15} style={{ marginLeft: -1 }} /> Resume
          </button>
        </div>
      </div>
    </div>
  );
}
