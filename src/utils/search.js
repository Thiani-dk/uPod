// src/utils/search.js
// Unified search across the whole library — tracks, albums, playlists, and
// artists — independent of Library.jsx's own search bar, which only ever
// filters within whatever tab is currently active (Albums search only
// matches album title/artist, Songs search only matches track title/artist,
// etc). This is the single query that spans everything at once.
import { useMemo } from "react";
import { usePlayerState } from "../store/PlayerContext";

function norm(str) {
  return (str || "").trim().toLowerCase();
}

function matches(haystack, q) {
  return norm(haystack).includes(q);
}

// Pure function — takes the raw library/albums/playlists plus a query
// string, returns matches grouped by kind. No React, no store access, so
// its output can be reasoned about (or unit tested) directly.
export function searchAll({ library, albums, playlists }, query) {
  const q = norm(query);
  // An empty query has nothing to search for yet — a dedicated search
  // surface should start blank, not dump the whole library (unlike
  // Library.jsx's per-tab filters, where an empty query is the "show
  // everything in this tab" default).
  if (!q) {
    return { query, tracks: [], albums: [], playlists: [], artists: [] };
  }

  const tracks = library.filter(
    (t) =>
      matches(t.title, q) ||
      matches(t.artist, q) ||
      matches(t.album, q) ||
      matches(t.albumArtist, q)
  );

  const matchedAlbums = albums.filter((a) => matches(a.title, q) || matches(a.artist, q));

  const matchedPlaylists = playlists.filter((p) => matches(p.name, q));

  // Unique artist names whose name itself matches — kept separate from
  // "tracks by this artist" above, since a search surface wants a distinct
  // "Artists" section to jump into (mirrors Instant Mix's artist list),
  // not just tracks that incidentally happen to match.
  const artistNames = new Set();
  for (const t of library) {
    if (matches(t.artist, q)) artistNames.add(t.artist);
    if (t.albumArtist && matches(t.albumArtist, q)) artistNames.add(t.albumArtist);
  }
  const artists = [...artistNames].sort((a, b) => a.localeCompare(b));

  return { query, tracks, albums: matchedAlbums, playlists: matchedPlaylists, artists };
}

// Thin hook wrapper for UI consumption — memoized so a re-render with the
// same query/library/albums/playlists doesn't redo the filtering work.
export function useUnifiedSearch(query) {
  // Searches the general pool, not the full library: search results feed
  // straight into the random-mix queue, so an unidentified file surfacing
  // here would put it back into exactly the flat pool the pool rule keeps
  // it out of. Albums and playlists are passed whole — a track is always
  // reachable through something it was explicitly assigned to.
  const { generalLibrary, albums, playlists } = usePlayerState();
  return useMemo(
    () => searchAll({ library: generalLibrary, albums, playlists }, query),
    [generalLibrary, albums, playlists, query]
  );
}
