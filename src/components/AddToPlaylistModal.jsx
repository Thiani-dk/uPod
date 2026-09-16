// src/components/AddToPlaylistModal.jsx
// This file was referenced by Library.jsx, NowPlaying.jsx, and
// PlaylistDetail.jsx from earlier work but never actually existed in the
// shipped project — a real bug (crash on use), not a design gap.
import React, { useState } from "react";
import { X, Plus, Bookmark, ListMusic, Check } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function AddToPlaylistModal({ track, onClose }) {
  useBackButtonClose(onClose);
  const { playlists } = usePlayerState();
  const { addTrackToPlaylist, removeTrackFromPlaylist, createPlaylistWithTrack } = usePlayerActions();
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const favorites = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);
  const otherPlaylists = playlists.filter((p) => p.id !== FAVORITES_PLAYLIST_ID);

  function handleToggle(playlist) {
    if (playlist.trackIds.includes(track.id)) {
      removeTrackFromPlaylist(playlist.id, track.id);
    } else {
      addTrackToPlaylist(playlist.id, track);
    }
    onClose();
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createPlaylistWithTrack(name, track);
    onClose();
  }

  function Row({ playlist, icon: Icon }) {
    const already = playlist.trackIds.includes(track.id);
    return (
      <button
        className="track-actions-row"
        onClick={() => handleToggle(playlist)}
        title={already ? `Remove from "${playlist.name}"` : `Add to "${playlist.name}"`}
      >
        <Icon size={16} />
        <span style={{ flex: 1 }}>{playlist.name}</span>
        {already ? (
          <Check size={15} style={{ color: "var(--accent)" }} />
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{playlist.trackIds.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet track-actions-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title" style={{ fontSize: 15 }}>Add to playlist</h3>
            <div className="settings-row-sub">{track.title}</div>
          </div>
          {/* Bare-icon close, the same pattern the sidebar uses — no
              box, muted at rest, accent on press. */}
          <button className="bare-close" onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>

        <div className="track-actions-list">
          {favorites && <Row playlist={favorites} icon={Bookmark} />}
          {otherPlaylists.map((p) => (
            <Row key={p.id} playlist={p} icon={ListMusic} />
          ))}

          {!creatingNew ? (
            <button className="track-actions-row" onClick={() => setCreatingNew(true)}>
              <Plus size={16} />
              <span>New playlist…</span>
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, padding: "10px 8px" }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
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
              <button className="primary-btn" onClick={handleCreate}>Create</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
