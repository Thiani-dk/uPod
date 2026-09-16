// src/screens/InstantMix.jsx
import React, { useMemo, useState } from "react";
import { ChevronLeft, Sparkles, Check } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";

export default function InstantMix({ onBack }) {
  const { generalLibrary, albums } = usePlayerState();
  const { playTrackList, saveQueueAsPlaylist } = usePlayerActions();
  const [selectedArtists, setSelectedArtists] = useState(new Set());
  const [selectedAlbums, setSelectedAlbums] = useState(new Set());
  const [query, setQuery] = useState("");

  const artists = useMemo(() => {
    const set = new Set(generalLibrary.map((t) => t.artist));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [generalLibrary]);

  const q = query.trim().toLowerCase();
  const filteredArtists = artists.filter((a) => !q || a.toLowerCase().includes(q));
  const filteredAlbums = albums.filter((a) => !q || a.title.toLowerCase().includes(q));

  function toggleArtist(name) {
    const next = new Set(selectedArtists);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelectedArtists(next);
  }
  function toggleAlbum(id) {
    const next = new Set(selectedAlbums);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedAlbums(next);
  }

  const mixTracks = useMemo(() => {
    const fromArtists = generalLibrary.filter((t) => selectedArtists.has(t.artist));
    const fromAlbums = albums
      .filter((al) => selectedAlbums.has(al.id))
      .flatMap((al) => al.tracks);
    const merged = [...fromArtists, ...fromAlbums];
    // De-dupe (a track can match both an artist and an album selection).
    return [...new Map(merged.map((t) => [t.id, t])).values()];
  }, [generalLibrary, albums, selectedArtists, selectedAlbums]);

  function generate() {
    if (mixTracks.length === 0) return;
    playTrackList(mixTracks, { shuffle: true });
  }

  function generateAndSave() {
    if (mixTracks.length === 0) return;
    playTrackList(mixTracks, { shuffle: true });
    saveQueueAsPlaylist(`Instant Mix (${mixTracks.length} tracks)`);
  }

  const selectionCount = selectedArtists.size + selectedAlbums.size;

  return (
    <div className="instant-mix-screen">
      <button className="back-btn" onClick={onBack}><ChevronLeft size={16} /> Play Now</button>

      <div className="detail-title" style={{ marginBottom: 4 }}>Instant Mix</div>
      <div className="settings-row-sub" style={{ marginBottom: 16 }}>
        Pick one or more artists and/or albums — everything gets merged into one shuffled mix.
      </div>

      <div className="search-bar" style={{ position: "static" }}>
        <input placeholder="Filter artists and albums…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="settings-group-title" style={{ marginTop: 18 }}>Artists</div>
      <div className="instant-mix-chip-row">
        {filteredArtists.map((name) => (
          <button
            key={name}
            className={`chip ${selectedArtists.has(name) ? "chip-active" : ""}`}
            onClick={() => toggleArtist(name)}
          >
            {selectedArtists.has(name) && <Check size={11} style={{ marginRight: 4 }} />}
            {name}
          </button>
        ))}
      </div>

      <div className="settings-group-title" style={{ marginTop: 20 }}>Albums</div>
      <div className="instant-mix-chip-row">
        {filteredAlbums.map((al) => (
          <button
            key={al.id}
            className={`chip ${selectedAlbums.has(al.id) ? "chip-active" : ""}`}
            onClick={() => toggleAlbum(al.id)}
          >
            {selectedAlbums.has(al.id) && <Check size={11} style={{ marginRight: 4 }} />}
            {al.title}
          </button>
        ))}
      </div>

      <div className="instant-mix-footer">
        <div className="settings-row-sub">
          {selectionCount === 0
            ? "Nothing selected yet."
            : `${mixTracks.length} tracks from ${selectionCount} selection${selectionCount === 1 ? "" : "s"}.`}
        </div>
        <div className="np-actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
          <button className="primary-btn" disabled={mixTracks.length === 0} onClick={generate}>
            <Sparkles size={14} /> Generate & Play
          </button>
          <button className="pill-btn" disabled={mixTracks.length === 0} onClick={generateAndSave}>
            Generate & Save as Playlist
          </button>
        </div>
      </div>
    </div>
  );
}
