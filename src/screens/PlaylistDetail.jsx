// src/screens/PlaylistDetail.jsx
import React, { useRef, useState } from "react";
import { ChevronLeft, Play, Plus, Bookmark, ImagePlus, Trash2, Wand2, MoreVertical, GripVertical, ListMinus } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID, playlistCoverKey } from "../store/PlayerContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import PlaylistActionsMenu from "../components/PlaylistActionsMenu";
import useDragReorder from "../utils/useDragReorder";

export default function PlaylistDetail({ playlist: playlistProp, onBack }) {
  const { library, queue, queueIndex, playlists, coverOverrides, queueToast } = usePlayerState();
  const {
    playPlaylist,
    addToQueue,
    movePlaylistTrack,
    removeTrackFromPlaylist,
    setPlaylistCoverOverride,
    clearPlaylistCoverOverride,
  } = usePlayerActions();
  const playlist = playlists.find((p) => p.id === playlistProp.id) || playlistProp;
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const coverInputRef = useRef(null);
  const cover = coverOverrides[playlistCoverKey(playlist.id)];

  // In-app only, same as album cover overrides — persists via IndexedDB
  // (see setPlaylistCoverOverride) so it survives a rescan/restart.
  async function handleCoverFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const buf = await file.arrayBuffer();
    setPlaylistCoverOverride(playlist.id, new Uint8Array(buf), file.type || "image/jpeg");
  }

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);

  const tracks = playlist.trackIds.map((id) => library.find((t) => t.id === id)).filter(Boolean);
  const currentTrackId = queue[queueIndex]?.id;

  // Exactly the Queue modal's hold-and-drag (see useDragReorder) — but it
  // moves the playlist's *stored* order, which is a different thing from
  // the queue's live one: what changes here is what a future Play queues
  // up, not what's playing now.
  //
  // trackIds can outnumber `tracks` if a file has gone missing since it
  // was added (the .filter(Boolean) above drops it), so the visible index
  // is translated back to the stored one before moving anything.
  // .track-list's own `gap`.
  const { draggingIndex, listRef, setRowRef, gripProps } = useDragReorder({
    count: tracks.length,
    gap: 1,
    onReorder: (from, to) => {
      const storedFrom = playlist.trackIds.indexOf(tracks[from].id);
      const storedTo = playlist.trackIds.indexOf(tracks[to].id);
      if (storedFrom !== -1 && storedTo !== -1) movePlaylistTrack(playlist.id, storedFrom, storedTo);
    },
  });

  return (
    <div className="detail-screen">
      {queueToast && <div className="shuffle-toast">{queueToast}</div>}
      <button className="back-btn" onClick={onBack}><ChevronLeft size={16} /> Back</button>

      <div className="detail-header">
        <div
          className={`detail-cover ${cover ? "" : "cover-glass"}`}
          style={{ position: "relative", ...(cover ? { background: `url(${cover}) center/cover` } : {}) }}
        >
          {!cover && <Wand2 size={48} style={{ color: "var(--accent)" }} />}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleCoverFile}
          />
          <button
            className="icon-btn small"
            onClick={() => coverInputRef.current.click()}
            aria-label="Change playlist cover"
            title="Change playlist cover"
            style={{ position: "absolute", right: 6, bottom: 6 }}
          >
            <ImagePlus size={14} />
          </button>
          {cover && (
            <button
              className="icon-btn small"
              onClick={() => clearPlaylistCoverOverride(playlist.id)}
              aria-label="Remove custom cover"
              title="Remove custom cover"
              style={{ position: "absolute", left: 6, bottom: 6 }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="detail-info">
          <div className="detail-kicker">Studio Playlist</div>
          {/* Renaming used to be an inline pencil here and nowhere else.
              It lives in the actions sheet now, alongside Delete, so a
              playlist has one menu rather than one affordance here and a
              different one in the Library list. */}
          <div className="detail-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {playlist.name}
            <button
              className="icon-btn small"
              onClick={() => setActionsOpen(true)}
              aria-label="Playlist actions"
              title="Playlist actions"
            >
              <MoreVertical size={14} />
            </button>
          </div>
          <div className="detail-sub">{tracks.length} tracks</div>
          <div className="detail-actions">
            <button className="primary-btn" onClick={() => playPlaylist(playlist)}>
              <Play size={15} style={{ marginLeft: -1 }} /> Play
            </button>
          </div>
        </div>
      </div>

      <div
        className={`track-list${draggingIndex !== null ? " track-list-dragging" : ""}`}
        ref={listRef}
      >
        {tracks.map((t, i) => {
          const trackIsFavorited = favPlaylist?.trackIds.includes(t.id);
          return (
            <div
              key={t.id}
              ref={setRowRef(i)}
              className={`track-row-wrap${draggingIndex === i ? " row-lifted" : ""}`}
              style={{ background: t.id === currentTrackId && draggingIndex !== i ? "var(--panel)" : undefined }}
            >
              <button
                className="queue-grip"
                {...gripProps(i)}
                aria-label={`Reorder ${t.title || "track"} — hold and drag`}
                title="Hold and drag to reorder"
              >
                <GripVertical size={14} />
              </button>
              <button className="track-row-play" onClick={() => playPlaylist(playlist, t)}>
                <span className="track-n">{i + 1}</span>
                <span className="track-title"><span className="track-title-text">{t.title}</span></span>
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); setAddToPlaylistTrack(t); }}
                aria-label="Add to playlist"
                title="Add to playlist"
                style={trackIsFavorited ? { color: "var(--accent)" } : undefined}
              >
                <Bookmark size={13} fill={trackIsFavorited ? "currentColor" : "none"} />
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); addToQueue(t); }}
                aria-label="Add to queue"
                title="Add to queue"
              >
                <Plus size={13} />
              </button>
              {/* Deliberately not a bin: this takes the track out of this
                  one playlist and nothing else. The file on disk and the
                  track's place in the library are untouched — that other,
                  irreversible thing is Delete from device, and it lives in
                  the Tracks tab's own actions menu behind a confirmation. */}
              <button
                className="icon-btn small track-edit-btn"
                onClick={(e) => { e.stopPropagation(); removeTrackFromPlaylist(playlist.id, t.id); }}
                aria-label={`Remove ${t.title || "track"} from this playlist`}
                title="Remove from this playlist"
              >
                <ListMinus size={13} />
              </button>
            </div>
          );
        })}
        {tracks.length === 0 && <div className="empty-state">No tracks in this playlist yet.</div>}
      </div>
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
      {actionsOpen && (
        <PlaylistActionsMenu
          playlist={playlist}
          onClose={() => setActionsOpen(false)}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}
