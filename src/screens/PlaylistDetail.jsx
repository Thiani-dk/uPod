// src/screens/PlaylistDetail.jsx
import React, { useState } from "react";
import { ChevronLeft, Play, Pencil, Check, Plus, Bookmark, FolderPlus } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";

export default function PlaylistDetail({ playlist: playlistProp, onBack }) {
  const { library, queue, queueIndex, playlists, queueToast } = usePlayerState();
  const { playPlaylist, renamePlaylist, addToQueue, addTrackToPlaylist, removeTrackFromPlaylist } = usePlayerActions();
  const playlist = playlists.find((p) => p.id === playlistProp.id) || playlistProp;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(playlist.name);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);

  function toggleFavorite(track) {
    if (favPlaylist?.trackIds.includes(track.id)) {
      removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    } else {
      addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    }
  }

  const tracks = playlist.trackIds.map((id) => library.find((t) => t.id === id)).filter(Boolean);
  const currentTrackId = queue[queueIndex]?.id;

  function saveName() {
    if (nameDraft.trim()) renamePlaylist(playlist.id, nameDraft.trim());
    setEditingName(false);
  }

  return (
    <div className="detail-screen">
      {queueToast && <div className="shuffle-toast">{queueToast}</div>}
      <button className="back-btn" onClick={onBack}><ChevronLeft size={16} /> Back</button>

      <div className="detail-header">
        <div className="detail-cover" style={{ background: "var(--accent)" }} />
        <div className="detail-info">
          <div className="detail-kicker">Studio Playlist</div>
          {editingName ? (
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                autoFocus
              />
              <button className="icon-btn small" onClick={saveName}><Check size={15} /></button>
            </div>
          ) : (
            <div className="detail-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {playlist.name}
              <button className="icon-btn small" onClick={() => setEditingName(true)}><Pencil size={13} /></button>
            </div>
          )}
          <div className="detail-sub">{tracks.length} tracks</div>
          <div className="detail-actions">
            <button className="primary-btn" onClick={() => playPlaylist(playlist)}>
              <Play size={15} style={{ marginLeft: -1 }} /> Play
            </button>
          </div>
        </div>
      </div>

      <div className="track-list">
        {tracks.map((t, i) => {
          const trackIsFavorited = favPlaylist?.trackIds.includes(t.id);
          return (
            <div
              key={t.id}
              className="track-row-wrap"
              style={{ background: t.id === currentTrackId ? "var(--panel)" : "transparent" }}
            >
              <button className="track-row-play" onClick={() => playPlaylist(playlist, t)}>
                <span className="track-n">{i + 1}</span>
                <span className="track-title"><span className="track-title-text">{t.title}</span></span>
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); toggleFavorite(t); }}
                aria-label={trackIsFavorited ? "Remove from Favorites" : "Add to Favorites"}
                title={trackIsFavorited ? "Remove from Favorites" : "Add to Favorites"}
                style={trackIsFavorited ? { color: "var(--accent)" } : undefined}
              >
                <Bookmark size={13} fill={trackIsFavorited ? "currentColor" : "none"} />
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); setAddToPlaylistTrack(t); }}
                aria-label="Add to playlist"
                title="Add to playlist"
              >
                <FolderPlus size={13} />
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); addToQueue(t); }}
                aria-label="Add to queue"
                title="Add to queue"
              >
                <Plus size={13} />
              </button>
            </div>
          );
        })}
        {tracks.length === 0 && <div className="empty-state">No tracks in this playlist yet.</div>}
      </div>
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
    </div>
  );
}
