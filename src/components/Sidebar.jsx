// src/components/Sidebar.jsx
import React from "react";
import { Disc3, Library, X, SlidersHorizontal, Wand2, Mic2, Settings as SettingsIcon, Sun, Moon } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import NoteMark from "./NoteMark";

export default function Sidebar({ screen, setScreen, open, setOpen, onOpenPlaylist }) {
  const { theme, playlists } = usePlayerState();
  const { setTheme } = usePlayerActions();

  const nav = [
    { id: "nowplaying", label: "Now Playing", icon: Disc3 },
    { id: "library", label: "Library", icon: Library },
    { id: "studio", label: "Studio", icon: Wand2 },
    { id: "karaoke", label: "Karaoke", icon: Mic2 },
    { id: "eq", label: "Equalizer", icon: SlidersHorizontal },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  function toggleTheme() {
    setTheme(theme === "obsidian" ? "glass" : "obsidian");
  }

  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <NoteMark size={18} style={{ color: "#fff" }} />
          </div>
          <div className="brand-text">
            <div className="brand-name">uPod</div>
            <div className="brand-tag">it's all about you!</div>
          </div>
          {/* Prominent close button, per design notes — not just tap-outside.
              Bare icon (no box) — styled in .sidebar-close. */}
          <button className="sidebar-close only-mobile" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={22} />
          </button>
        </div>

        <nav className="nav-list">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${screen === n.id ? "active" : ""}`}
              onClick={() => { setScreen(n.id); setOpen(false); }}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        {playlists.length > 0 && (
          <>
            <div className="sidebar-section-label">Playlists</div>
            <nav className="nav-list nav-list-scroll">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  className="nav-item nav-item-playlist"
                  onClick={() => { onOpenPlaylist(p); setOpen(false); }}
                >
                  <span className="nav-item-playlist-dot" />
                  <span>{p.name}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "obsidian" ? <Sun size={15} /> : <Moon size={15} />}
            <span>{theme === "obsidian" ? "Switch to Liquid Glass" : "Switch to Matte Obsidian"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
