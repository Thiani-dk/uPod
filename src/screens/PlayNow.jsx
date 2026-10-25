// src/screens/PlayNow.jsx
import React, { useEffect, useState } from "react";
import { Play, Shuffle, Sparkles } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { computeLibraryStats } from "../utils/listeningStats";
import NoteMark from "../components/NoteMark";
import NowSpinning from "../components/NowSpinning";
import FallingNotes from "../components/FallingNotes";

function TrackCarousel({ title, tracks, playTrackList, playTrackListFrom }) {
  if (!tracks || tracks.length === 0) return null;
  return (
    <div className="carousel-section">
      <div className="carousel-title">{title}</div>
      <div className="carousel-scroll">
        {tracks.map((t) => (
          <button key={t.id} className="carousel-card" onClick={() => playTrackListFrom(tracks, t)}>
            <div className={`carousel-card-cover ${t.cover ? "" : "cover-glass"}`} style={t.cover ? { background: `url(${t.cover}) center/cover` } : undefined}>
              {!t.cover && <NoteMark size={26} style={{ color: "var(--accent-text)" }} />}
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
              {!al.cover && <NoteMark size={26} style={{ color: "var(--accent-text)" }} />}
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

// Below this, a folder walk that comes back almost instantly reads as a
// tap that did nothing. The disc keeps turning until it's up, so the
// gesture is always visibly answered.
const MIN_SPIN_MS = 900;

export default function PlayNow({ onOpenAlbum, onOpenInstantMix }) {
  const { library, generalLibrary, albums, playlists, queueIndex, playing, newMusicFound } = usePlayerState();
  const { playTrackList, playTrackListFrom, checkForNewMusic, getAudioLevels } = usePlayerActions();
  const [stats, setStats] = useState(null);
  const [spinning, setSpinning] = useState(false);

  function refresh() {
    setStats(computeLibraryStats(generalLibrary, albums, playlists));
  }

  // The slow half: a walk of the music folder. Anything it finds
  // surfaces through the existing "found new files" banner at the top
  // of the app, which is already the one place that offers the rescan —
  // so this only has to run it and keep the record turning while it
  // does. The stats half is `refresh` above, and is instant.
  async function scanFolder() {
    if (spinning) return;
    setSpinning(true);
    const startedAt = Date.now();
    refresh();
    try {
      await checkForNewMusic();
    } catch {
      // checkForNewMusic reports its own failures into state; a folder
      // that can't be read must not leave the record spinning forever.
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SPIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
    }
    setSpinning(false);
  }

  // Says nothing at rest: the thing explains itself by turning, and a
  // standing caption under every visit is noise. NowSpinning puts its
  // own brief confirmations here after a tap.
  const spinStatus = spinning
    ? "Checking your folder…"
    : newMusicFound?.added > 0
      ? `Found ${newMusicFound.added} new ${newMusicFound.added === 1 ? "file" : "files"}`
      : "";

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generalLibrary, albums, playlists, queueIndex, playing]);

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
      <div className="stat-card stat-card-hero">
        <div className="stat-card-title">Listening</div>
        <div className="stat-hero-grid">
          <div className="stat-hero">
            <div className="stat-hero-value">{stats.tracksPlayedThisMonth}</div>
            <div className="stat-hero-label">Tracks this month</div>
          </div>
          <div className="stat-hero">
            <div className="stat-hero-value">{stats.timePlayedThisMonth}</div>
            <div className="stat-hero-label">Time this month</div>
          </div>
          <div className="stat-hero">
            <div className="stat-hero-value">{stats.lifetimeTracksPlayed}</div>
            <div className="stat-hero-label">Lifetime tracks played</div>
          </div>
          <div className="stat-hero">
            <div className="stat-hero-value">{stats.totalTimePlayed}</div>
            <div className="stat-hero-label">Total time played</div>
          </div>
        </div>
      </div>

      <div className="stat-card stat-card-lib">
        <div className="stat-card-title">Your library</div>
        <div className="stat-mini-grid">
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.tracks}</div>
            <div className="stat-mini-label">Tracks</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.artists}</div>
            <div className="stat-mini-label">Artists</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.albums}</div>
            <div className="stat-mini-label">Albums</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.genres}</div>
            <div className="stat-mini-label">Genres</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.neverPlayedCount}</div>
            <div className="stat-mini-label">Never played</div>
          </div>
          <div className="stat-mini">
            <div className="stat-mini-value">{stats.totals.modifiedCount}</div>
            <div className="stat-mini-label">Tracks modified</div>
          </div>
        </div>
      </div>

      {/* One positioned box around both, because the notes fall out of
          the record at the top of it and dissolve into the Instant Mix
          tile at the bottom — they belong to neither element alone. */}
      <div className="spin-to-mix">
        <FallingNotes playing={playing} getAudioLevels={getAudioLevels} />

        <NowSpinning
          playing={playing}
          busy={spinning}
          status={spinStatus}
          onRefreshStats={refresh}
          onScanFolder={scanFolder}
        />

        <button className="instant-mix-tile" onClick={onOpenInstantMix}>
          <Sparkles size={18} />
          <div>
            <div className="instant-mix-title">Instant Mix</div>
            <div className="instant-mix-sub">Build a mix from artists or albums, on the spot</div>
          </div>
        </button>
      </div>

      <TrackCarousel title="Never Played" tracks={stats.neverPlayed} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Most Played This Month" tracks={stats.mostPlayedThisMonth} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Favorites" tracks={stats.favoriteTracks} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Recently Played" tracks={stats.recentlyPlayed} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <TrackCarousel title="Recently Added" tracks={stats.recentlyAdded} playTrackList={playTrackList} playTrackListFrom={playTrackListFrom} />
      <AlbumCarousel title="Popular Albums" albums={stats.popularAlbums} onOpenAlbum={onOpenAlbum} playTrackList={playTrackList} />
    </div>
  );
}
