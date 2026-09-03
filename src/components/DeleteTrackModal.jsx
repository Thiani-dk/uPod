// src/components/DeleteTrackModal.jsx
// Confirmation gate in front of PlayerContext's deleteTrack — this is the
// one genuinely destructive, unrecoverable action in the app (a real file
// on disk, not just an app-state removal), so it gets a real dialog
// requiring an explicit tap rather than a single-tap delete from a menu.
import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function DeleteTrackModal({ track, onConfirm, onCancel }) {
  useBackButtonClose(onCancel);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    // onConfirm resolves { ok, error } — it does NOT throw, so a failed
    // disk delete (permission revoked, file already gone, etc.) surfaces
    // here instead of silently closing as if it worked.
    const result = await onConfirm();
    if (!result?.ok) {
      setDeleting(false);
      setError(result?.error || "Couldn't delete this file.");
    }
    // On success, the parent unmounts this modal by clearing its
    // confirm-target state — nothing left to do here.
  }

  // Renders on top of TrackActionsMenu's own overlay (which closes the
  // whole sheet on backdrop click) — stopPropagation here so tapping this
  // modal's backdrop only cancels the delete confirmation, not the sheet
  // underneath it too.
  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        e.stopPropagation();
        if (!deleting) onCancel();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Delete from device?</div>
          <button className="icon-btn small" onClick={onCancel} aria-label="Cancel" disabled={deleting}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-row-sub" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={16} style={{ color: "#e5484d", flexShrink: 0, marginTop: 1 }} />
          <span>
            "{track.title}" will be <strong>permanently deleted from your device</strong> — not just removed
            from uPod's library. This cannot be undone.
          </span>
        </div>

        {error && (
          <div className="settings-row-sub" style={{ marginTop: 12, color: "#e5484d" }}>
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button className="danger-btn" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
