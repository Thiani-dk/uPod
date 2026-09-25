// src/components/DeletePlaylistModal.jsx
// The same seriousness as DeleteTrackModal — an explicit dialog rather
// than a single tap in a menu — but deliberately not the same warning.
// Deleting a playlist touches no files and loses no tracks; what it costs
// is the curation. So this says what actually goes, says what doesn't,
// and points at the undo window that follows rather than calling itself
// permanent, which would be a lie.
import React from "react";
import { X } from "lucide-react";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function DeletePlaylistModal({ playlist, onConfirm, onCancel }) {
  useBackButtonClose(onCancel);
  const count = playlist.trackIds.length;

  // Renders on top of PlaylistActionsMenu's own overlay (which closes the
  // whole sheet on backdrop click) — stopPropagation here so tapping this
  // modal's backdrop only cancels the confirmation, not the sheet under it.
  return (
    <div className="modal-scrim" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Delete this playlist?</div>
          <button className="icon-btn small" onClick={onCancel} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>

        <div className="settings-row-sub">
          "{playlist.name}" and its order of {count} {count === 1 ? "track" : "tracks"} will be removed.
          The tracks themselves stay in your library and none of their files are touched.
        </div>

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="danger-btn" onClick={onConfirm}>Delete playlist</button>
        </div>
      </div>
    </div>
  );
}
