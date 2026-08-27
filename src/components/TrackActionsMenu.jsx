// src/components/TrackActionsMenu.jsx
import React from "react";
import { X, Play, ListPlus, ListMusic, Bookmark, Disc3, User, FolderPlus, Pencil } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function TrackActionsMenu({ track, onClose, onPlay, onOpenAlbum, onFilterArtist, onAddToPlaylist, onEdit }) {
  useBackButtonClose(onClose);
  const { albums, playlists } = usePlayerState();
  const { playNext, addToQueue, addTrackToPlaylist, removeTrackFromPlaylist } = usePlayerActions();

  const isFavorite = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID)?.trackIds.includes(track.id);

  function openAlbumForTrack() {
    const album = albums.find((a) => a.tracks.some((t) => t.id === track.id));
    if (album) onOpenAlbum(album);
    onClose();
  }

  function toggleFavorite() {
    if (isFavorite) {
      removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    } else {
      addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    }
    onClose();
  }

  const rows = [
    { label: "Play", icon: Play, onClick: () => { onPlay(track); onClose(); } },
    { label: "Play Next", icon: ListPlus, onClick: () => { playNext(track); onClose(); } },
    { label: "Queue", icon: ListMusic, onClick: () => { addToQueue(track); onClose(); } },
    { label: isFavorite ? "Remove from Favorites" : "Add to Favorites", icon: Bookmark, onClick: toggleFavorite },
    { label: "Album", icon: Disc3, onClick: openAlbumForTrack },
    { label: "Artist", icon: User, onClick: () => { onFilterArtist(track.artist); onClose(); } },
    { label: "Add to Playlist", icon: FolderPlus, onClick: () => { onAddToPlaylist(track); onClose(); } },
    { label: "Edit", icon: Pencil, onClick: () => { onEdit(track); onClose(); } },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet track-actions-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title" style={{ fontSize: 15 }}>{track.title}</h3>
            <div className="settings-row-sub">{track.artist}</div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="track-actions-list">
          {rows.map((r) => (
            <button key={r.label} className="track-actions-row" onClick={r.onClick}>
              <r.icon size={16} />
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
