// src/components/TopBar.jsx
import React from "react";
import { Menu } from "lucide-react";

const TITLES = {
  nowplaying: "Now Playing",
  library: "Library",
  album: "Album",
  eq: "Equalizer",
  studio: "Studio",
  playlist: "Playlist",
  karaoke: "Karaoke Mode",
};

export default function TopBar({ onMenu, screen }) {
  return (
    <div className="topbar">
      <button className="icon-btn only-mobile" onClick={onMenu}>
        <Menu size={19} />
      </button>
      <div className="topbar-title">{TITLES[screen] || ""}</div>
    </div>
  );
}
