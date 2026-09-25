// src/screens/Library.jsx
import React, { useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Search, X, FolderOpen, Wand2, MoreVertical, Bookmark, User, Play, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";
import { usePlayerState, usePlayerActions, FAVORITES_PLAYLIST_ID, playlistCoverKey } from "../store/PlayerContext";
import { useUnifiedSearch } from "../utils/search";
import NoteMark from "../components/NoteMark";
import PlayNow from "./PlayNow";
import TrackActionsMenu from "../components/TrackActionsMenu";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import MetadataEditModal from "../components/MetadataEditModal";
import MetadataCleaner from "../components/MetadataCleaner";
import PlaylistActionsMenu from "../components/PlaylistActionsMenu";
import BulkActionBar from "../components/BulkActionBar";
import BulkSelectBox from "../components/BulkSelectBox";
import useDragReorder from "../utils/useDragReorder";
import useBulkSelect from "../utils/useBulkSelect";

const TABS = [
  { id: "playnow", label: "Play Now" },
  { id: "albums", label: "Albums" },
  { id: "playlists", label: "Playlists" },
  { id: "songs", label: "Tracks" },
];

// Deliberately mirrors Play Now's real layout — two stat cards and a
// carousel row — so the screen doesn't reflow when the library lands.
// Blocks only, no placeholder zeros: a "0 tracks this month" that
// silently becomes 340 is exactly the lie this is replacing.
function LibrarySkeleton() {
  return (
    <div className="library-skeleton" aria-busy="true" aria-label="Loading your library">
      <div className="skeleton-card skeleton-card-hero" />
      <div className="skeleton-card skeleton-card-lib" />
      <div className="skeleton-carousel">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-cover" />
        ))}
      </div>
    </div>
  );
}

export default function Library({ onOpenAlbum, onOpenPlaylist, onOpenInstantMix }) {
  const { albums, playlists, library, generalLibrary, coverOverrides, selectedFolderName, loadingLibrary, libraryHydrating, libraryProgress, libraryError, pendingFolderConfirm, queueToast } = usePlayerState();
  const { pickFolder, pickNativeFolder, playRandomMixFrom, commitCleanerResult, movePlaylist } =
    usePlayerActions();
  const [tab, setTab] = useState("playnow");
  // The persistent top search bar is the ONLY search input on this screen.
  // It spans the whole library (Artists/Albums/Playlists/Tracks) regardless
  // of the selected tab pill (see src/utils/search.js); while it has a
  // value its results replace whatever the current tab would render. There
  // is deliberately no per-tab filter input — the tab lists always show
  // their full contents.
  const [searchQuery, setSearchQuery] = useState("");
  // Tracks-tab ordering only. Albums/Playlists/Play Now keep whatever
  // order the store hands them — this toggle is deliberately rendered
  // inside the Tracks tab rather than beside the shared search bar, so
  // it can't read as a control over the whole library.
  const [trackSortDesc, setTrackSortDesc] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  const [cleanTrack, setCleanTrack] = useState(null);
  const [editTrack, setEditTrack] = useState(null);
  const [menuPlaylist, setMenuPlaylist] = useState(null);
  // Tracks tab only — Albums/Playlists/Play Now are lists of albums and
  // playlists, not of tracks, so there is nothing there to select.
  const { selectedIds, selecting, clearSelection, rowProps } = useBulkSelect();
  const inputRef = useRef(null);

  const searchResults = useUnifiedSearch(searchQuery);
  const searching = searchQuery.trim().length > 0;

  // localeCompare with numeric collation so "Track 2" sorts before
  // "Track 10", and base sensitivity so case and accents don't split
  // otherwise-adjacent titles apart.
  const sortedTracks = useMemo(() => {
    const dir = trackSortDesc ? -1 : 1;
    return [...generalLibrary].sort(
      (a, b) =>
        dir * (a.title || "").localeCompare(b.title || "", undefined, { numeric: true, sensitivity: "base" })
    );
  }, [generalLibrary, trackSortDesc]);

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

  // Tapping a track here starts a fresh random mix drawn from the pool
  // that's currently on screen — the full Tracks list, or the current
  // unified-search results while searching — with the tapped track first.
  // It deliberately no longer queues that list sequentially from the tap.
  // Album/Playlist detail keep their own sequential behaviour via
  // playAlbumFromTrack/playPlaylist, and Play Now's carousels keep theirs
  // via playTrackListFrom; both are left untouched.
  // Reordering the playlist list is reordering state.playlists itself, so
  // the Library tab and the sidebar's shortcuts move together — they both
  // render that one array in order.
  const {
    draggingIndex: draggingPlaylist,
    listRef: playlistListRef,
    setRowRef: setPlaylistRowRef,
    gripProps: playlistGripProps,
  } = useDragReorder({ count: playlists.length, gap: 6, onReorder: movePlaylist });

  function playSong(track) {
    // The Tracks tab lists the general pool, so the mix must draw from
    // the same set the user is actually looking at.
    const visiblePool = searching ? searchResults.tracks : generalLibrary;
    playRandomMixFrom(visiblePool, track);
  }

  function filterByArtist(artist) {
    // "Artist" (from a track's action menu or a search result) narrows via
    // the one shared search bar now — its results include an Artists chip
    // plus every matching album and track.
    setSearchQuery(artist);
  }

  const favPlaylist = playlists.find((p) => p.id === FAVORITES_PLAYLIST_ID);


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
            onClick={() => { setTab(t.id); clearSelection(); }}
          >
            {t.id === "playnow" && <Play size={12} fill="currentColor" strokeWidth={0} />}
            {t.label}
          </button>
        ))}
      </div>

      {/* The cache read is async (see libraryHydrating in PlayerContext),
          so on a cold launch the library is empty for a beat before it
          fills. Showing the real screen through that window means blank
          stat cards — or worse, "No music loaded yet" — that then
          jarringly repopulate. A skeleton holds the shape instead. */}
      {libraryHydrating && albums.length === 0 && <LibrarySkeleton />}

      {albums.length === 0 && !loadingLibrary && !libraryHydrating && pendingFolderConfirm && (
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

      {albums.length === 0 && !loadingLibrary && !libraryHydrating && !pendingFolderConfirm && (
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
        <PlayNow onOpenAlbum={onOpenAlbum} onOpenInstantMix={onOpenInstantMix} />
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
                        onClick={(e) => { e.stopPropagation(); setAddToPlaylistTrack(t); }}
                        aria-label="Add to playlist"
                        title="Add to playlist"
                        style={isFavorite ? { color: "var(--accent)" } : undefined}
                      >
                        <Bookmark size={15} fill={isFavorite ? "currentColor" : "none"} />
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
        <div
          className={`playlist-list${draggingPlaylist !== null ? " playlist-list-dragging" : ""}`}
          ref={playlistListRef}
        >
          {playlists.map((p, i) => (
            <div
              key={p.id}
              ref={setPlaylistRowRef(i)}
              className={`playlist-row-wrap${draggingPlaylist === i ? " row-lifted" : ""}`}
            >
              <button
                className="queue-grip"
                {...playlistGripProps(i)}
                aria-label={`Reorder ${p.name} — hold and drag`}
                title="Hold and drag to reorder"
              >
                <GripVertical size={14} />
              </button>
              <button className="playlist-row" onClick={() => onOpenPlaylist(p)}>
                {playlistThumb(p)}
                <div className="playlist-row-meta">
                  <div className="playlist-row-name">{p.name}</div>
                  <div className="playlist-row-count">{p.trackIds.length} tracks</div>
                </div>
              </button>
              <button
                className="icon-btn small"
                onClick={(e) => { e.stopPropagation(); setMenuPlaylist(p); }}
                aria-label={`Actions for ${p.name}`}
                title="Playlist actions"
              >
                <MoreVertical size={15} />
              </button>
            </div>
          ))}
          {playlists.length === 0 && (
            <div className="empty-state">
              No playlists yet — render an effect in Studio to create one.
            </div>
          )}
        </div>
      )}

      {albums.length > 0 && !searching && tab === "songs" && generalLibrary.length > 0 && (
        <div className="track-sort-row">
          <button
            className="ghost-btn track-sort-btn"
            onClick={() => setTrackSortDesc((d) => !d)}
            aria-label={trackSortDesc ? "Sort A to Z" : "Sort Z to A"}
            title={trackSortDesc ? "Sorted Z–A — tap for A–Z" : "Sorted A–Z — tap for Z–A"}
          >
            {trackSortDesc ? <ArrowUpZA size={14} /> : <ArrowDownAZ size={14} />}
            <span>{trackSortDesc ? "Z–A" : "A–Z"}</span>
          </button>
        </div>
      )}

      {albums.length > 0 && !searching && tab === "songs" && (
        <div className="track-list">
          {sortedTracks.map((t) => {
            const selected = selecting && selectedIds.has(t.id);
            return (
              <div
                key={t.id}
                className={`track-row-wrap track-row-thumb-wrap${selected ? " track-row-selected" : ""}`}
              >
                <button
                  className="track-row-play track-row-with-thumb"
                  // A tap starts the random mix until selection mode is
                  // on, at which point it toggles instead — see
                  // useBulkSelect.
                  {...rowProps(t.id, () => playSong(t))}
                >
                  {selecting ? (
                    <BulkSelectBox checked={selected} />
                  ) : (
                    <div className={`track-row-thumb ${t.cover ? "" : "cover-glass"}`} style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}>
                      {!t.cover && <NoteMark size={18} style={{ color: "var(--accent)" }} />}
                    </div>
                  )}
                  <span className="track-row-text">
                    <span className="track-row-text-title">{t.title}</span>
                    <span className="track-row-text-artist">{t.artist}</span>
                  </span>
                </button>
                {!selecting && (
                  <button
                    className="icon-btn small track-edit-btn"
                    onClick={(e) => { e.stopPropagation(); setMenuTrack(t); }}
                    aria-label="Track actions"
                    title="Track actions"
                  >
                    <MoreVertical size={15} />
                  </button>
                )}
              </div>
            );
          })}
          {generalLibrary.length === 0 && (
            <div className="empty-state">
              {library.length === 0
                ? "No tracks in your library yet."
                : "Nothing identified yet. Tracks appear here once they've been matched online or have proper tags — use \u201cClean up info\u201d on a track to sort one out."}
            </div>
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
          onClean={setCleanTrack}
        />
      )}
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
      {editTrack && (
        <MetadataEditModal track={editTrack} onClose={() => setEditTrack(null)} />
      )}
      {cleanTrack && (
        <MetadataCleaner
          track={cleanTrack}
          onClose={() => setCleanTrack(null)}
          onCommit={(record) => commitCleanerResult(cleanTrack.id, record)}
        />
      )}

      {/* The whole selection goes through the existing Select Playlist
          popup in one action — same sheet, same "New playlist…" row, just
          handed a list instead of a single track. */}
      {/* Scoped to the tab it belongs to: switching tabs clears the
          selection outright, and searching replaces the list the selection
          was made from, so neither leaves the bar stranded over rows that
          are no longer on screen. */}
      {!searching && tab === "songs" && (
        <BulkActionBar selectedIds={selectedIds} pool={generalLibrary} onClear={clearSelection} />
      )}
      {menuPlaylist && (
        <PlaylistActionsMenu playlist={menuPlaylist} onClose={() => setMenuPlaylist(null)} />
      )}
    </div>
  );
}
