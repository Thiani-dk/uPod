// src/components/UndoSnackbar.jsx
// Lives in the Shell rather than in whichever screen did the deleting,
// because deleting a playlist from PlaylistDetail navigates away from that
// screen immediately — an undo anchored there would unmount with it. The
// store owns the window (see PLAYLIST_UNDO_MS); this only renders it.
import React from "react";
import { Undo2 } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";

export default function UndoSnackbar() {
  const { playlistUndo } = usePlayerState();
  const { undoDeletePlaylist } = usePlayerActions();
  if (!playlistUndo) return null;

  return (
    <div className="undo-snackbar" role="status">
      <span className="undo-snackbar-text">Deleted "{playlistUndo.playlist.name}"</span>
      <button className="undo-snackbar-btn" onClick={undoDeletePlaylist}>
        <Undo2 size={13} /> Undo
      </button>
    </div>
  );
}
