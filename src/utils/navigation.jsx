// src/utils/navigation.jsx
// The three places a track's actions menu can send you that aren't on the
// screen you opened it from: its album, its artist, and (for completeness)
// a playlist. Library used to own "Album" and "Artist" because it was the
// only screen wiring the menu up; now that every track row opens the same
// menu, those two have to work from AlbumDetail and PlaylistDetail too,
// and neither of those screens can navigate on its own.
//
// Deliberately a context rather than another prop threaded through every
// screen: the screens in between don't care, and a track row six levels
// down shouldn't make them care.
import React, { createContext, useContext } from "react";

const NavContext = createContext(null);

export function NavProvider({ value, children }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// Returns no-ops rather than throwing when there's no provider, so a
// screen rendered outside the shell (tests, Classic mode) still mounts.
const NO_NAV = { openAlbum: () => {}, openPlaylist: () => {}, openArtist: () => {} };

export function useNav() {
  return useContext(NavContext) || NO_NAV;
}
