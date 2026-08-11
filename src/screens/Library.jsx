// src/screens/Library.jsx
import React, { useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Search, X, FolderOpen, Wand2, MoreVertical, Bookmark, FolderPlus } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID } from "../store/PlayerContext";
import NoteMark from "../components/NoteMark";
import PlayNow from "./PlayNow";
import TrackActionsMenu from "../components/TrackActionsMenu";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import MetadataEditModal from "../components/MetadataEditModal";

const TABS = [
  { id: "playnow", label: "Play Now" },
  { id: "albums", label: "Albums" },
  { id: "playlists", label: "Playlists" },
  { id: "songs", label: "Tracks" },
];

export default function Library({ onOpenAlbum, onOpenPlaylist, onOpenInstantMix }) {
  const { albums, playlists, library, selectedFolderName, loadingLibrary, libraryProgress, libraryError, pendingFolderConfirm, queueToast } = usePlayerState();
  const { pickFolder, pickNativeFolder, playAlbumFromTrack, addTrackToPlaylist, removeTrackFromPlaylist } = usePlayerActions();
  const [tab, setTab] = useState("playnow");
  const [query, setQuery] = useState("");
  const [menuTrack, setMenuTrack] = useState(null);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  const [editTrack, setEditTrack] = useState(null);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();

  const filteredAlbums = albums.filter(
    (a) => !q || a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
  );
  const filteredPlaylists = playlists.filter((p) => !q || p.name.toLowerCase().includes(q));
  const filteredSongs = library.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  );

  function handleFiles(e) {
    if (e.target.files && e.target.files.length > 0) {
      pickFolder(e.target.files);
    }
  }

  function chooseFolder() {
    if (Capacitor.isNativePlatform()) {
      pickNativeFolder();
    } else {
      inputRef.current.click();
    }
  }

  function playSong(track) {
    const album = albums.find((a) => a.tracks.some((t) => t.id === track.id));
    if (album) playAlbumFromTrack(album, track);
  }

  function filterByArtist(artist) {
    setTab("songs");
    setQuery(artist);
  }

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);

  function toggleFavorite(track) {
    if (favPlaylist?.trackIds.includes(track.id)) {
      removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    } else {
      addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    }
  }

  const searchPlaceholder =
    tab === "albums" ? "Search albums…" : tab === "playlists" ? "Search playlists…" : "Search tracks…";

  return (
    <div className="lib-screen">
      {queueToast && <div className="shuffle-toast">{queueToast}</div>}

      <input
        ref={inputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: "none" }}
        onChange={handleFiles}
      />

      {tab !== "playnow" && (
        <div className="search-bar">
          <Search size={16} />
          <input
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className="tab-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {albums.length === 0 && !loadingLibrary && pendingFolderConfirm && (
        <div className="empty-state" style={{ padding: "40px 0" }}>
          Found a music folder at "{pendingFolderConfirm}" — use this folder?
          <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="primary-btn" onClick={() => pickNativeFolder()}>
              <FolderOpen size={15} /> Use this folder
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            Wrong folder? Change the path in Settings first, or tap "Change" there.
          </div>
        </div>
      )}

      {albums.length === 0 && !loadingLibrary && !pendingFolderConfirm && (
        <div className="empty-state" style={{ padding: "40px 0" }}>
          No music loaded yet.
          <div style={{ marginTop: 12 }}>
            <button className="primary-btn" onClick={chooseFolder}>
              <FolderOpen size={15} /> Choose your music folder
            </button>
          </div>
          {libraryError && (
            <div style={{ marginTop: 12, color: "var(--accent, #e55)" }}>{libraryError}</div>
          )}
        </div>
      )}

      {loadingLibrary && (
        <div className="empty-state">
          {libraryProgress
            ? `Reading ${libraryProgress.done}/${libraryProgress.total} tracks…`
            : "Reading your music folder…"}
        </div>
      )}

      {selectedFolderName && albums.length > 0 && tab !== "playnow" && (
        <div className="folder-chip" style={{ marginBottom: 14 }}>
          <FolderOpen size={14} />
          <span>{selectedFolderName}</span>
        </div>
      )}

      {albums.length > 0 && tab === "playnow" && (
        <PlayNow onOpenAlbum={onOpenAlbum} onOpenPlaylist={onOpenPlaylist} onOpenInstantMix={onOpenInstantMix} />
      )}

      {albums.length > 0 && tab === "albums" && (
        <div className="album-grid">
          {filteredAlbums.map((al) => (
            <button key={al.id} className="album-card" onClick={() => onOpenAlbum(al)}>
              <div
                className={`album-cover ${al.cover ? "" : "cover-glass"}`}
                style={al.cover ? { background: `url(${al.cover}) center/cover` } : undefined}
              >
                {!al.cover && (
                  <NoteMark size={40} style={{ color: "var(--accent)" }} />
                )}
              </div>
              <div className="album-card-title">{al.title}</div>
              <div className="album-card-artist">{al.artist}{al.year ? ` · ${al.year}` : ""}</div>
            </button>
          ))}
          {filteredAlbums.length === 0 && (
            <div className="empty-state">No albums match "{query}".</div>
          )}
        </div>
      )}

      {albums.length > 0 && tab === "playlists" && (
        <div className="playlist-list">
          {filteredPlaylists.map((p) => (
            <button key={p.id} className="playlist-row" onClick={() => onOpenPlaylist(p)}>
              <div className="playlist-thumb" style={{ background: "var(--accent)" }}>
                <Wand2 size={16} color="#fff" />
              </div>
              <div className="playlist-row-meta">
                <div className="playlist-row-name">{p.name}</div>
                <div className="playlist-row-count">{p.trackIds.length} tracks</div>
              </div>
            </button>
          ))}
          {filteredPlaylists.length === 0 && (
            <div className="empty-state">
              {playlists.length === 0
                ? "No playlists yet — render an effect in Studio to create one."
                : `No playlists match "${query}".`}
            </div>
          )}
        </div>
      )}

      {albums.length > 0 && tab === "songs" && (
        <div className="track-list">
          {filteredSongs.map((t) => {
            const isFavorite = favPlaylist?.trackIds.includes(t.id);
            return (
              <div key={t.id} className="track-row-wrap track-row-thumb-wrap">
                <button className="track-row-play track-row-with-thumb" onClick={() => playSong(t)}>
                  <div className={`track-row-thumb ${t.cover ? "" : "cover-glass"}`} style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}>
                    {!t.cover && <NoteMark size={18} style={{ color: "var(--accent)" }} />}
                  </div>
                  <span className="track-row-text">
                    <span className="track-row-text-title">{t.title}</span>
                    <span className="track-row-text-artist">{t.artist}</span>
                  </span>
                </button>
                <button
                  className="icon-btn small track-edit-btn"
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(t); }}
                  aria-label={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                  title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                  style={isFavorite ? { color: "var(--accent)" } : undefined}
                >
                  <Bookmark size={15} fill={isFavorite ? "currentColor" : "none"} />
                </button>
                <button
                  className="icon-btn small track-edit-btn"
                  onClick={(e) => { e.stopPropagation(); setAddToPlaylistTrack(t); }}
                  aria-label="Add to playlist"
                  title="Add to playlist"
                >
                  <FolderPlus size={15} />
                </button>
                <button
                  className="icon-btn small track-edit-btn"
                  onClick={(e) => { e.stopPropagation(); setMenuTrack(t); }}
                  aria-label="Track actions"
                  title="Track actions"
                >
                  <MoreVertical size={15} />
                </button>
              </div>
            );
          })}
          {filteredSongs.length === 0 && (
            <div className="empty-state">No tracks match "{query}".</div>
          )}
        </div>
      )}

      {menuTrack && (
        <TrackActionsMenu
          track={menuTrack}
          onClose={() => setMenuTrack(null)}
          onPlay={playSong}
          onOpenAlbum={onOpenAlbum}
          onFilterArtist={filterByArtist}
          onAddToPlaylist={setAddToPlaylistTrack}
          onEdit={setEditTrack}
        />
      )}
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
      {editTrack && (
        <MetadataEditModal track={editTrack} onClose={() => setEditTrack(null)} />
      )}
    </div>
  );
}
