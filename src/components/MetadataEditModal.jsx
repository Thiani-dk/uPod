// src/components/MetadataEditModal.jsx
// Hand-editing a track's info. Never writes back to the original file on
// disk, same platform constraint every other in-app change (Studio
// render, track-order fix) already operates under — but it is persisted
// now, in the same store the cleaner writes to. It used to change
// state.library only, so an edit quietly evaporated on the next rescan or
// relaunch because the values lived nowhere.
import React, { useState } from "react";
import { X } from "lucide-react";
import { usePlayerActions } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function MetadataEditModal({ track, onClose }) {
  useBackButtonClose(onClose);
  const { declareTrackMetadata } = usePlayerActions();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const [trackNum, setTrackNum] = useState(track.track ? String(track.track) : "");

  function handleSave() {
    declareTrackMetadata(track.id, {
      title: title.trim() || track.title,
      artist: artist.trim() || track.artist,
      album: album.trim() || track.album,
      track: trackNum === "" ? 0 : parseInt(trackNum, 10) || 0,
    });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sheet-solid" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit track info</h3>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="edit-form">
          <label className="edit-field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="edit-field">
            <span>Artist</span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <label className="edit-field">
            <span>Album</span>
            <input value={album} onChange={(e) => setAlbum(e.target.value)} />
          </label>
          <label className="edit-field">
            <span>Track #</span>
            <input
              type="number"
              min="0"
              value={trackNum}
              onChange={(e) => setTrackNum(e.target.value)}
            />
          </label>

          <div className="edit-form-note">
            These edits apply in the app only — your original file on disk
            isn't touched. Changing the album name may move this track into
            a different album.
          </div>

          <button className="primary-btn" style={{ width: "100%" }} onClick={handleSave}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
