// src/screens/PlayNow.jsx
import React, { useEffect, useState } from "react";
import { Play, Shuffle, RefreshCw, Sparkles } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { computeLibraryStats } from "../utils/listeningStats";
import NoteMark from "../components/NoteMark";

function TrackCarousel({ title, tracks, playTrackList, playTrackListFrom }) {
  if (!tracks || tracks.length === 0) return null;
  return (
    <div className="carousel-section">
      <div className="carousel-title">{title}</div>
      <div className="carousel-scroll">
        {tracks.map((t) => (
          <button key={t.id} className="carousel-card" onClick={() => playTrackListFrom(tracks, t)}>
            <div className={`carousel-card-cover ${t.cover ? "" : "cover-glass"}`} style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}>
              {!t.cover && <NoteMark size={26} style={{ color: "var(--accent)" }} />}
            </div>
            <div className="carousel-card-title">{t.title}</div>
            <div className="carousel-card-sub">{t.artist}</div>
          </button>
        ))}
      </div>
      <div className="carousel-actions">
        <button className="pill-btn" onClick={() => playTrackList(tracks, { shuffle: false })}>
          <Play size={13} /> Play
        </button>
        <button className="pill-btn" onClick={() => playTrackList(tracks, { shuffle: true })}>
          <Shuffle size={13} /> Shuffle Play
        </button>
      </div>
    </div>
  );
}

function AlbumCarousel({ title, albums, onOpenAlbum, playTrackList }) {
  if (!albums || albums.length === 0) return null;
  const allTracks = albums.flatMap((a) => a.tracks);
  return (
    <div className="carousel-section">
      <div className="carousel-title">{title}</div>
      <div className="carousel-scroll">
        {albums.map((al) => (
          <button key={al.id} className="carousel-card" onClick={() => onOpenAlbum(al)}>
            <div className={`carousel-card-cover ${al.cover ? "" : "cover-glass"}`} style={al.cover ? { background: `url(${al.cover}) center/cover` } : undefined}>
              {!al.cover && <NoteMark size={26} style={{ color: "var(--accent)" }} />}
            </div>
            <div className="carousel-card-title">{al.title}</div>
            <div className="carousel-card-sub">{al.artist}</div>
          </button>
        ))}
      </div>
      <div className="carousel-actions">
        <button className="pill-btn" onClick={() => playTrackList(allTracks, { shuffle: false })}>
          <Play size={13} /> Play
        </button>
        <button className="pill-btn" onClick={() => playTrackList(allTracks, { shuffle: true })}>
          <Shuffle size={13} /> Shuffle Play
        </button>
      </div>
    </div>
  );
}

function PlaylistCarousel({ playlists, onOpenPlaylist }) {
  if (!playlists || playlists.length === 0) return null;
  return (
    <div className="carousel-section">
      <div className="carousel-title">Playlists</div>
      <div className="carousel-scroll">
        {playlists.map((p) => (
          <button key={p.id} className="carousel-card" onClick={() => onOpenPlaylist(p)}>
            <div className="carousel-card-cover cover-glass">
              <NoteMark size={26} style={{ color: "var(--accent)" }} />
            </div>
            <div className="carousel-card-title">{p.name}</div>
            <div className="carousel-card-sub">{p.trackIds.length} tracks</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PlayNow({ onOpenAlbum, onOpenPlaylist, onOpenInstantMix }) {
  const { library, albums, playlists, queueIndex, playing } = usePlayerState();
  const { playTrackList, playTrackListFrom } = usePlayerActions();
  const [stats, setStats] = useState(null);

  function refresh() {
    setStats(computeLibraryStats(library, albums, playlists));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, albums, playlists, queueIndex, playing]);

  if (library.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "40px 0" }}>
        Load your music folder to see your listening stats here.
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="playnow-screen">
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-value">{stats.lifetimeTracksPlayed}</div>
          <div className="stat-label">Lifetime tracks played</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totals.genres}</div>
          <div className="stat-label">Genres</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totals.tracks}</div>
          <div className="stat-label">Tracks</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totals.artists}</div>
          <div className="stat-label">Artists</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totals.albums}</div>
          <div className="stat-label">Albums</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totals.neverPlayedCount}</div>
          <div className="stat-label">Never played</div>
        </div>
      </div>

      <div className="stat-grid stat-grid-wide">
        <div className="stat-tile">
          <div className="stat-value">{stats.tracksPlayedThisMonth}</div>
          <div className="stat-label">Tracks played this month</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.timePlayedThisMonth}</div>
          <div className="stat-label">Time played this month</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.totalTimePlayed}</div>
          <div className="stat-label">Total time played</div>
        </div>
      </div>

      <button className="ghost-btn" style={{ marginBottom: 20 }} onClick={refresh}>
        <RefreshCw size={13} style={{ marginRight: 6 }} /> Refresh
      </button>

      <button className="instant-mix-tile" onClick={onOpenInstantMix}>
        <Sparkles size={18} />
        <div>
          <div className="instant-mix-title">Instant Mix</div>
          <div className="instant-mix-sub">Build a mix from artists or albums, on the spot</div>
        </div>
      </button>

      <TrackCarousel title="Never Played" tracks={stats.neverPlayed} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Most Played This Month" tracks={stats.mostPlayedThisMonth} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Favorites" tracks={stats.favoriteTracks} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Recently Played" tracks={stats.recentlyPlayed} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Recently Added" tracks={stats.recentlyAdded} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <AlbumCarousel title="Popular Albums" albums={stats.popularAlbums} onOpenAlbum={onOpenAlbum} playTrackList={playTrackList} />
      <PlaylistCarousel playlists={playlists} onOpenPlaylist={onOpenPlaylist} />
    </div>
  );
}
