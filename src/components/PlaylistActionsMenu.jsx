// src/components/PlaylistActionsMenu.jsx
// A playlist's own actions sheet, the counterpart to TrackActionsMenu and
// built on the same sheet markup. Playlists previously had no menu at all:
// renaming lived only inside PlaylistDetail's header and there was nowhere
// to delete from. This is that missing home, reachable from the Library
// row and from the detail screen itself.
import React, { useState } from "react";
import { X, Play, Pencil, Trash2, Check } from "lucide-react";
import { usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";
import DeletePlaylistModal from "./DeletePlaylistModal";

export default function PlaylistActionsMenu({ playlist, onClose, onDeleted }) {
  useBackButtonClose(onClose);
  const { playPlaylist, renamePlaylist, deletePlaylist } = usePlayerActions();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(playlist.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Favourite Tunes is uPod's own — every track row's bookmark writes to
  // it by a fixed id — so it can be renamed but not deleted. The reducer
  // refuses it too; this just keeps the affordance from being offered.
  const canDelete = playlist.id !== FAVORITES_PLAYLIST_ID;

  function saveName() {
    const name = nameDraft.trim();
    if (name && name !== playlist.name) renamePlaylist(playlist.id, name);
    onClose();
  }

  function handleConfirmDelete() {
    deletePlaylist(playlist.id);
    setConfirmingDelete(false);
    onClose();
    // Lets a caller that was *showing* this playlist (PlaylistDetail) step
    // away from a screen whose subject no longer exists. The Library row
    // doesn't need it — the row simply stops rendering.
    onDeleted?.();
  }

  const rows = [
    { label: "Play", icon: Play, onClick: () => { playPlaylist(playlist); onClose(); } },
    { label: "Rename", icon: Pencil, onClick: () => setRenaming(true) },
    ...(canDelete
      ? [{ label: "Delete playlist", icon: Trash2, danger: true, onClick: () => setConfirmingDelete(true) }]
      : []),
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet track-actions-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title" style={{ fontSize: 15 }}>{playlist.name}</h3>
            <div className="settings-row-sub">
              {playlist.trackIds.length} {playlist.trackIds.length === 1 ? "track" : "tracks"}
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {renaming ? (
          <div style={{ display: "flex", gap: 8, padding: "10px 8px" }}>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              placeholder="Playlist name…"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
            <button className="icon-btn small" onClick={saveName} aria-label="Save name">
              <Check size={15} />
            </button>
          </div>
        ) : (
          <div className="track-actions-list">
            {rows.map((r) => (
              <button
                key={r.label}
                className="track-actions-row"
                onClick={r.onClick}
                style={r.danger ? { color: "#e5484d" } : undefined}
              >
                <r.icon size={16} />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {confirmingDelete && (
        <DeletePlaylistModal
          playlist={playlist}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
