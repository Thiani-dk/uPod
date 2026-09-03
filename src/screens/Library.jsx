// src/screens/Library.jsx
import React, { useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Search, X, FolderOpen, Wand2, MoreVertical, Bookmark, FolderPlus, User, Play } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID, playlistCoverKey } from "../store/PlayerContext";
import { useUnifiedSearch } from "../utils/search";
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
  const { albums, playlists, library, coverOverrides, selectedFolderName, loadingLibrary, libraryProgress, libraryError, pendingFolderConfirm, queueToast } = usePlayerState();
  const { pickFolder, pickNativeFolder, playTrackListFrom, addTrackToPlaylist, removeTrackFromPlaylist } = usePlayerActions();
  const [tab, setTab] = useState("playnow");
  // The persistent top search bar is the ONLY search input on this screen.
  // It spans the whole library (Artists/Albums/Playlists/Tracks) regardless
  // of the selected tab pill (see src/utils/search.js); while it has a
  // value its results replace whatever the current tab would render. There
  // is deliberately no per-tab filter input — the tab lists always show
  // their full contents.
  const [searchQuery, setSearchQuery] = useState("");
  const [menuTrack, setMenuTrack] = useState(null);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  const [editTrack, setEditTrack] = useState(null);
  const inputRef = useRef(null);

  const searchResults = useUnifiedSearch(searchQuery);
  const searching = searchQuery.trim().length > 0;

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

  // Tapping a track here queues the whole visible Tracks list (respecting
  // an active unified search), not just its album — that's Album/Playlist
  // detail's job via playAlbumFromTrack/playPlaylist, left untouched.
  function playSong(track) {
    const visibleTracks = searching ? searchResults.tracks : library;
    playTrackListFrom(visibleTracks, track);
  }

  function filterByArtist(artist) {
    // "Artist" (from a track's action menu or a search result) narrows via
    // the one shared search bar now — its results include an Artists chip
    // plus every matching album and track.
    setSearchQuery(artist);
  }

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);

  function toggleFavorite(track) {
    if (favPlaylist?.trackIds.includes(track.id)) {
      removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, track.id);
    } else {
      addTrackToPlaylist(FAVORITES_PLAYLIST_ID, track);
    }
  }

  // Editing a playlist's cover lives in PlaylistDetail (same as album
  // covers only being editable in AlbumDetail) — rows here just reflect
  // whatever override is already set, falling back to the plain Wand2
  // placeholder otherwise.
  function playlistThumb(p) {
    const cover = coverOverrides[playlistCoverKey(p.id)];
    return (
      <div
        className="playlist-thumb"
        style={cover ? { background: `url(${cover}) center/cover` } : { background: "var(--accent)" }}
      >
        {!cover && <Wand2 size={16} color="#fff" />}
      </div>
    );
  }

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

      {/* Persistent unified search — always visible, spans the whole
          library, independent of the selected tab pill. */}
      <div className="search-bar">
        <Search size={16} />
        <input
          placeholder="Search your whole library…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="icon-btn small" onClick={() => setSearchQuery("")}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="tab-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${t.id === "playnow" ? "tab-btn-primary" : ""} ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.id === "playnow" && <Play size={12} fill="currentColor" strokeWidth={0} />}
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

      {selectedFolderName && albums.length > 0 && !searching && tab !== "playnow" && (
        <div className="folder-chip" style={{ marginBottom: 14 }}>
          <FolderOpen size={14} />
          <span>{selectedFolderName}</span>
        </div>
      )}

      {albums.length > 0 && !searching && tab === "playnow" && (
        <PlayNow onOpenAlbum={onOpenAlbum} onOpenPlaylist={onOpenPlaylist} onOpenInstantMix={onOpenInstantMix} />
      )}

      {albums.length > 0 && searching && (
        <div className="search-results">
          {searchResults.tracks.length === 0 &&
            searchResults.albums.length === 0 &&
            searchResults.playlists.length === 0 &&
            searchResults.artists.length === 0 && (
              <div className="empty-state">No results for "{searchQuery.trim()}".</div>
            )}

          {searchResults.artists.length > 0 && (
            <>
              <div className="settings-group-title">Artists</div>
              <div className="instant-mix-chip-row" style={{ marginBottom: 20 }}>
                {searchResults.artists.map((name) => (
                  <button key={name} className="chip" onClick={() => filterByArtist(name)}>
                    <User size={11} style={{ marginRight: 4 }} />
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}

          {searchResults.albums.length > 0 && (
            <>
              <div className="settings-group-title">Albums</div>
              <div className="album-grid" style={{ marginBottom: 20 }}>
                {searchResults.albums.map((al) => (
                  <button key={al.id} className="album-card" onClick={() => onOpenAlbum(al)}>
                    <div
                      className={`album-cover ${al.cover ? "" : "cover-glass"}`}
                      style={al.cover ? { background: `url(${al.cover}) center/cover` } : undefined}
                    >
                      {!al.cover && <NoteMark size={40} style={{ color: "var(--accent)" }} />}
                    </div>
                    <div className="album-card-title">{al.title}</div>
                    <div className="album-card-artist">{al.artist}{al.year ? ` · ${al.year}` : ""}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {searchResults.playlists.length > 0 && (
            <>
              <div className="settings-group-title">Playlists</div>
              <div className="playlist-list" style={{ marginBottom: 20 }}>
                {searchResults.playlists.map((p) => (
                  <button key={p.id} className="playlist-row" onClick={() => onOpenPlaylist(p)}>
                    {playlistThumb(p)}
                    <div className="playlist-row-meta">
                      <div className="playlist-row-name">{p.name}</div>
                      <div className="playlist-row-count">{p.trackIds.length} tracks</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {searchResults.tracks.length > 0 && (
            <>
              <div className="settings-group-title">Tracks</div>
              <div className="track-list">
                {searchResults.tracks.map((t) => {
                  const isFavorite = favPlaylist?.trackIds.includes(t.id);
                  return (
                    <div key={t.id} className="track-row-wrap track-row-thumb-wrap">
                      <button className="track-row-play track-row-with-thumb" onClick={() => playSong(t)}>
                        <div className={`track-row-thumb ${t.cover ? "" : "cover-glass"}`} style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}>
                          {!t.cover && <NoteMark size={18} style={{ color: "var(--accent)" }} />}
                        </div>
                        <span className="track-row-text">
                          <span className="track-row-text-title">{t.title}</span>
                          <span className="track-row-text-artist">{t.artist} · {t.album}</span>
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
              </div>
            </>
          )}
        </div>
      )}

      {albums.length > 0 && !searching && tab === "albums" && (
        <div className="album-grid">
          {albums.map((al) => (
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
        </div>
      )}

      {albums.length > 0 && !searching && tab === "playlists" && (
        <div className="playlist-list">
          {playlists.map((p) => (
            <button key={p.id} className="playlist-row" onClick={() => onOpenPlaylist(p)}>
              {playlistThumb(p)}
              <div className="playlist-row-meta">
                <div className="playlist-row-name">{p.name}</div>
                <div className="playlist-row-count">{p.trackIds.length} tracks</div>
              </div>
            </button>
          ))}
          {playlists.length === 0 && (
            <div className="empty-state">
              No playlists yet — render an effect in Studio to create one.
            </div>
          )}
        </div>
      )}

      {albums.length > 0 && !searching && tab === "songs" && (
        <div className="track-list">
          {library.map((t) => {
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
          {library.length === 0 && (
            <div className="empty-state">No tracks in your library yet.</div>
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
