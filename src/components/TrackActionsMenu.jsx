// src/components/TrackActionsMenu.jsx
import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { X, Play, ListPlus, ListMusic, Bookmark, Heart, Disc3, User, Pencil, Trash2, Sparkles, Share2 } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";
import { canShareTrack, shareTrack } from "../utils/shareTrack";
import DeleteTrackModal from "./DeleteTrackModal";

export default function TrackActionsMenu({ track, onClose, onPlay, onOpenAlbum, onFilterArtist, onAddToPlaylist, onEdit, onClean }) {
  useBackButtonClose(onClose);
  const { albums, playlists } = usePlayerState();
  const {
    playNext,
    addToQueue,
    deleteTrack,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    showToast,
  } = usePlayerActions();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Deleting the real file only makes sense for a native track that
  // actually has one — a browser-picked or Studio-rendered track has no
  // on-device path to delete.
  const canDelete = Capacitor.isNativePlatform() && track.native;

  async function handleConfirmDelete() {
    const result = await deleteTrack(track);
    if (result.ok) {
      setConfirmingDelete(false);
      onClose();
    }
    return result;
  }

  // Favourite Tunes is a real playlist (FAVORITES_PLAYLIST_ID) that the
  // app creates on first run and never lets you delete, so "favourite" is
  // just membership of it — the same thing the bookmark icons on these
  // rows were already toggling, and what Now Playing's heart reads.
  const isFavorite = Boolean(
    playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID)?.trackIds.includes(track.id)
  );

  function toggleFavorite() {
    if (isFavorite) removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    else addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    onClose();
  }

  // Closes first: on Android the system share sheet takes over the screen
  // and coming back to a stale menu over the row reads as a stuck modal.
  async function handleShare() {
    onClose();
    const message = await shareTrack(track);
    if (message) showToast(message);
  }

  function openAlbumForTrack() {
    const album = albums.find((a) => a.tracks.some((t) => t.id === track.id));
    if (album) onOpenAlbum(album);
    onClose();
  }


  // Order follows the design reference: the three playback actions, then
  // favourites, then the two places this track lives, then the things that
  // change it. Two deliberate departures from the picture — "Clean up
  // info" stays (it is a real, separate feature from Edit and dropping it
  // would lose it outright), and Share sits above Delete so the one
  // irreversible row is always last.
  const rows = [
    { label: "Play", icon: Play, onClick: () => { onPlay(track); onClose(); } },
    { label: "Play Next", icon: ListPlus, onClick: () => { playNext(track); onClose(); } },
    { label: "Queue", icon: ListMusic, onClick: () => { addToQueue(track); onClose(); } },
    {
      label: isFavorite ? "Remove from Favourites" : "Add to Favourites",
      icon: Heart,
      fill: isFavorite,
      onClick: toggleFavorite,
    },
    { label: "Album", icon: Disc3, onClick: openAlbumForTrack },
    { label: "Artist", icon: User, onClick: () => { onFilterArtist(track.artist); onClose(); } },
    { label: "Add to playlist", icon: Bookmark, onClick: () => { onAddToPlaylist(track); onClose(); } },
    { label: "Edit", icon: Pencil, onClick: () => { onEdit(track); onClose(); } },
    // Sits next to Edit deliberately: Edit is "I know what this is, fix
    // the text", Clean up is "I don't know what this is, help me work it
    // out". Different jobs, adjacent enough to find.
    { label: "Clean up info", icon: Sparkles, onClick: () => { onClean(track); onClose(); } },
    // Hidden outright where there's no share sheet and no clipboard,
    // rather than offered as a row that does nothing.
    ...(canShareTrack() ? [{ label: "Share", icon: Share2, onClick: handleShare }] : []),
    ...(canDelete
      ? [{ label: "Delete from device", icon: Trash2, danger: true, onClick: () => setConfirmingDelete(true) }]
      : []),
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
            <button
              key={r.label}
              className="track-actions-row"
              onClick={r.onClick}
              style={r.danger ? { color: "#e5484d" } : undefined}
            >
              <r.icon size={16} fill={r.fill ? "currentColor" : "none"} />
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {confirmingDelete && (
        <DeleteTrackModal
          track={track}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
