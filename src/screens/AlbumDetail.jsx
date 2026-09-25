// src/screens/AlbumDetail.jsx
import React, { useRef, useState } from "react";
import { ChevronLeft, Play, Shuffle, Heart, Wand2, Pencil, Plus, ImagePlus, RotateCcw, Bookmark } from "lucide-react";
import { usePlayerActions, usePlayerState, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import NoteMark from "../components/NoteMark";
import MetadataEditModal from "../components/MetadataEditModal";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import BulkActionBar from "../components/BulkActionBar";
import BulkSelectBox from "../components/BulkSelectBox";
import useBulkSelect from "../utils/useBulkSelect";

function formatDur(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AlbumDetail({ album: albumProp, onBack }) {
  const { playAlbumFromTrack, fixAlbumTrackOrder, addToQueue, playTrackList, addTracksToPlaylist, removeTracksFromPlaylist, setAlbumCoverOverride, clearAlbumCoverOverride } = usePlayerActions();
  const { queue, queueIndex, albums, trackOrderStatus, playlists, coverOverrides } = usePlayerState();
  const [lastFixResult, setLastFixResult] = useState(null);
  const [editingTrack, setEditingTrack] = useState(null);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  // The same long-press selection the Tracks tab has (see useBulkSelect).
  // It's safe on these rows specifically because nothing else here claims
  // a hold on them — unlike PlaylistDetail, whose rows carry a drag
  // handle for reordering.
  const { selectedIds, selecting, clearSelection, rowProps } = useBulkSelect();
  const coverInputRef = useRef(null);

  const album = albums.find((a) => a.id === albumProp.id) || albumProp;
  const currentTrackId = queue[queueIndex]?.id;
  const fixing = trackOrderStatus && typeof trackOrderStatus === "string";
  const fixError = trackOrderStatus && trackOrderStatus.error;

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);
  const albumIsFavorited = favPlaylist && album.tracks.every((t) => favPlaylist.trackIds.includes(t.id));

  function toggleAlbumFavorite() {
    if (albumIsFavorited) {
      removeTracksFromPlaylist(FAVORITES_PLAYLIST_ID, album.tracks.map((t) => t.id));
    } else {
      addTracksToPlaylist(FAVORITES_PLAYLIST_ID, album.tracks);
    }
  }


  async function handleFixOrder() {
    setLastFixResult(null);
    const result = await fixAlbumTrackOrder(album);
    if (result.ok) setLastFixResult(result);
  }

  function searchArtistOnGoogle() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(album.artist)}`, "_blank", "noopener");
  }

  const hasCoverOverride = Boolean(coverOverrides[album.id]);

  // In-app only — this changes what uPod displays, not the file's actual
  // embedded ID3 picture (same constraint as Studio renders, track-order
  // fixes, and metadata editing elsewhere in the app).
  async function handleCoverFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const buf = await file.arrayBuffer();
    setAlbumCoverOverride(album.id, new Uint8Array(buf), file.type || "image/jpeg");
  }

  return (
    <div className="detail-screen">
      <button className="back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Library
      </button>

      <div className="detail-header">
        <div
          className={`detail-cover ${album.cover ? "" : "cover-glass"}`}
          style={{ position: "relative", ...(album.cover ? { background: `url(${album.cover}) center/cover` } : {}) }}
        >
          {!album.cover && (
            <NoteMark size={56} style={{ color: "var(--accent)" }} />
          )}
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
            aria-label="Change album cover"
            title="Change album cover"
            style={{ position: "absolute", right: 6, bottom: 6 }}
          >
            <ImagePlus size={14} />
          </button>
          {hasCoverOverride && (
            <button
              className="icon-btn small"
              onClick={() => clearAlbumCoverOverride(album.id)}
              aria-label="Reset to original cover"
              title="Reset to original cover"
              style={{ position: "absolute", left: 6, bottom: 6 }}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
        <div className="detail-info">
          <div className="detail-kicker">Album</div>
          <div className="detail-title">{album.title}</div>
          <div className="detail-sub">
            <button className="detail-sub-artist" onClick={searchArtistOnGoogle} title="Search this artist on Google">
              {album.artist}
            </button>
            {" "}{album.year ? `· ${album.year}` : ""} · {album.tracks.length} tracks
          </div>
          <div className="detail-actions">
            <button className="primary-btn" onClick={() => playAlbumFromTrack(album, album.tracks[0])}>
              <Play size={15} style={{ marginLeft: -1 }} /> Play
            </button>
            <button className="icon-btn ring" onClick={() => playTrackList(album.tracks, { shuffle: true })} title="Shuffle play this album">
              <Shuffle size={16} />
            </button>
            <button
              className="icon-btn ring"
              onClick={toggleAlbumFavorite}
              title={albumIsFavorited ? "Remove all tracks from Favourite Tunes" : "Add all tracks to Favourite Tunes"}
              style={albumIsFavorited ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
            >
              <Heart size={16} fill={albumIsFavorited ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </div>

      <div className="track-order-row">
        <span className="settings-row-sub">
          {fixError
            ? fixError
            : lastFixResult
            ? `Matched ${lastFixResult.matched}/${lastFixResult.total} tracks to the online release.`
            : "Track numbers came from your files — fix them against the real release if they look wrong."}
        </span>
        <button className="pill-btn" disabled={fixing} onClick={handleFixOrder}>
          <Wand2 size={13} /> {fixing ? trackOrderStatus : "Fix track order online"}
        </button>
      </div>

      <div className="track-list">
        {album.tracks.map((t) => {
          const trackIsFavorited = favPlaylist?.trackIds.includes(t.id);
          const selected = selecting && selectedIds.has(t.id);
          return (
            <div
              key={t.id}
              className={`track-row-wrap${selected ? " track-row-selected" : ""}`}
              style={{ background: t.id === currentTrackId && !selected ? "var(--panel)" : undefined }}
            >
              <button
                className="track-row-play"
                // A tap plays the track until selection mode is on, at
                // which point it toggles instead — see useBulkSelect.
                {...rowProps(t.id, () => playAlbumFromTrack(album, t))}
              >
                {/* The checkbox takes the track number's slot, so rows
                    keep their width going in and out of the mode. */}
                {selecting ? (
                  <span className="track-n"><BulkSelectBox checked={selected} /></span>
                ) : (
                  <span className="track-n">{t.trackConfirmed === false ? "?" : t.track || "–"}</span>
                )}
                <span className="track-title">
                  <span className="track-title-text">{t.title}</span>
                  {t.id === currentTrackId && (
                    <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>
                      playing
                    </span>
                  )}
                </span>
                <span className="track-dur">{formatDur(null)}</span>
              </button>
              {/* Per-row actions stand down while a selection is in
                  progress, same as the Tracks tab's overflow button —
                  they act on one track, and the screen is about several. */}
              {!selecting && (
                <>
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
                  <button
                    className="icon-btn small track-edit-btn"
                    onClick={() => setEditingTrack(t)}
                    aria-label="Edit track info"
                    title="Edit track info"
                  >
                    <Pencil size={13} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {editingTrack && (
        <MetadataEditModal track={editingTrack} onClose={() => setEditingTrack(null)} />
      )}
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
      <BulkActionBar selectedIds={selectedIds} pool={album.tracks} onClear={clearSelection} />
    </div>
  );
}

