// src/App.jsx
import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";
import "./styles/global.css";
import { PlayerProvider, usePlayerState } from "./store/PlayerContext";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MiniPlayer from "./components/MiniPlayer";
import NowPlaying from "./screens/NowPlaying";
import Library from "./screens/Library";
import AlbumDetail from "./screens/AlbumDetail";
import EqScreen from "./screens/EqScreen";
import Studio from "./screens/Studio";
import PlaylistDetail from "./screens/PlaylistDetail";
import InstantMix from "./screens/InstantMix";
import Karaoke from "./screens/Karaoke";
import Settings from "./screens/Settings";
import { getFontStack } from "./utils/fonts";

function Shell() {
  const { theme, accentColor, fontFamily, queue, queueIndex, albums } = usePlayerState();
  const [screen, setScreen] = useState("library");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [activePlaylist, setActivePlaylist] = useState(null);
  // Remembers which screen opened the playlist (library, studio, sidebar
  // shortcut...) so the playlist's Back button returns you there instead
  // of always dropping you back on Studio.
  const [playlistOrigin, setPlaylistOrigin] = useState("library");

  function openAlbum(album) {
    setActiveAlbum(album);
    setScreen("album");
  }

  function openPlaylist(playlist) {
    // If a playlist is opened from within another playlist (edge case),
    // keep the original origin rather than chaining to "playlist" itself.
    setPlaylistOrigin(screen === "playlist" ? playlistOrigin : screen);
    setActivePlaylist(playlist);
    setScreen("playlist");
  }

  const rootClass = Capacitor.isNativePlatform() ? "upod-root native-platform" : "upod-root";

  return (
    <div className={rootClass} data-theme={theme} style={{ "--accent": accentColor, fontFamily: getFontStack(fontFamily) }}>
      <div className="shell">
        <Sidebar
          screen={screen}
          setScreen={setScreen}
          open={sidebarOpen}
          setOpen={setSidebarOpen}
          onOpenPlaylist={openPlaylist}
        />
        <div className="main">
          <TopBar onMenu={() => setSidebarOpen(true)} screen={screen} />
          <div className="content">
            {screen === "nowplaying" && (
              <NowPlaying
                onOpenAlbum={() => {
                  // Tapping the art/title should open the currently playing
                  // track's album — not whatever album was last explicitly
                  // browsed to. Playback can start from Songs, a playlist,
                  // Instant Mix, or the queue, none of which set activeAlbum,
                  // so that stale value can't be relied on here.
                  const track = queue[queueIndex];
                  const album = track && albums.find((a) => a.tracks.some((t) => t.id === track.id));
                  if (album) openAlbum(album);
                }}
                onOpenEq={() => setScreen("eq")}
                onOpenKaraoke={() => setScreen("karaoke")}
              />
            )}
            {screen === "library" && (
              <Library onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} onOpenInstantMix={() => setScreen("instantmix")} />
            )}
            {screen === "instantmix" && <InstantMix onBack={() => setScreen("library")} />}
            {screen === "album" && activeAlbum && (
              <AlbumDetail album={activeAlbum} onBack={() => setScreen("library")} />
            )}
            {screen === "eq" && <EqScreen />}
            {screen === "studio" && <Studio onOpenPlaylist={openPlaylist} />}
            {screen === "playlist" && activePlaylist && (
              <PlaylistDetail playlist={activePlaylist} onBack={() => setScreen(playlistOrigin)} />
            )}
            {screen === "karaoke" && <Karaoke />}
            {screen === "settings" && <Settings />}
          </div>
          {screen !== "nowplaying" && <MiniPlayer onOpen={() => setScreen("nowplaying")} />}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}
