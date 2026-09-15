// src/screens/Settings.jsx
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FolderOpen, Check, Play, Type } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import { FONT_OPTIONS } from "../utils/fonts";
import FontPickerModal from "../components/FontPickerModal";
import { BUTTON_PACKS } from "../components/TransportButtons";
import { getMusicFolderPath, setMusicFolderPath, MUSIC_FOLDER_ROOT } from "../audio/nativeFolder";
import { BACKGROUND_PLAYBACK_GUIDANCE } from "../utils/backgroundPlaybackWatchdog";

function PackPreview({ pack }) {
  const { shuffle: ShuffleIcon, back: BackIcon, forward: ForwardIcon, repeat: RepeatIcon } = pack.icons;
  return (
    <div className={pack.cls} style={{ marginTop: 0 }}>
      <button className="tp-btn tp-side" tabIndex={-1}><ShuffleIcon size={14} /></button>
      <button className="tp-btn tp-side" tabIndex={-1}><BackIcon size={16} /></button>
      <button className="tp-btn tp-main" tabIndex={-1}><Play size={18} /></button>
      <button className="tp-btn tp-side" tabIndex={-1}><ForwardIcon size={16} /></button>
      <button className="tp-btn tp-side" tabIndex={-1}><RepeatIcon size={14} /></button>
    </div>
  );
}

export default function Settings({ onOpenReviewTracks }) {
  const { theme, buttonPack, fontFamily, selectedFolderName, albums, library, libraryError, loadingLibrary, libraryProgress, checkingForNewMusic, newMusicFound } =
    usePlayerState();
  const pendingReviewCount = library.filter((t) => t.possiblyNotMusic && !t.reviewStatus).length;
  const { setTheme, setButtonPack, pickFolder, pickNativeFolder, checkForNewMusic } = usePlayerActions();
  const inputRef = useRef(null);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  const [folderPathInput, setFolderPathInput] = useState("");
  const [folderPathSaved, setFolderPathSaved] = useState(false);

  const currentFontLabel = FONT_OPTIONS.find((f) => f.id === fontFamily)?.label || "System Font";

  useEffect(() => {
    if (!isNative) return;
    getMusicFolderPath().then(setFolderPathInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFiles(e) {
    if (e.target.files && e.target.files.length > 0) {
      pickFolder(e.target.files);
    }
  }

  function chooseFolder() {
    if (isNative) {
      pickNativeFolder();
    } else {
      inputRef.current.click();
    }
  }

  async function saveFolderPathAndRescan() {
    const normalized = await setMusicFolderPath(folderPathInput);
    setFolderPathInput(normalized);
    setFolderPathSaved(true);
    setTimeout(() => setFolderPathSaved(false), 2000);
    pickNativeFolder();
  }

  return (
    <div className="settings-screen">
      <input
        ref={inputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: "none" }}
        onChange={handleFiles}
      />

      <div>
        <div className="settings-group-title">Library</div>

        <div className="settings-row settings-row-tappable" onClick={chooseFolder}>
          <div>
            <div className="settings-row-label">Music folder</div>
            <div className="settings-row-sub">
              {selectedFolderName || "No folder selected yet"}
            </div>
            {libraryError && (
              <div className="settings-row-sub" style={{ color: "var(--accent, #e55)" }}>{libraryError}</div>
            )}
          </div>
          <button className="ghost-btn" onClick={(e) => { e.stopPropagation(); chooseFolder(); }}>
            <FolderOpen size={14} style={{ marginRight: 6 }} />
            Change
          </button>
        </div>

        {isNative && (
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div>
              <div className="settings-row-label">Folder path</div>
              <div className="settings-row-sub">
                Relative to your phone's shared storage — always kept under "{MUSIC_FOLDER_ROOT}".
              </div>
            </div>
            <input
              value={folderPathInput}
              onChange={(e) => setFolderPathInput(e.target.value)}
              placeholder={MUSIC_FOLDER_ROOT}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
              }}
            />
            <button className="ghost-btn" onClick={saveFolderPathAndRescan}>
              {folderPathSaved ? "Saved — rescanning…" : "Save & rescan"}
            </button>
          </div>
        )}

        {isNative && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Check for new music</div>
              <div className="settings-row-sub">
                {checkingForNewMusic
                  ? "Checking…"
                  : newMusicFound
                    ? "Changes found — see the prompt at the top of the screen."
                    : "Compares your folder against the saved library without re-reading tags, so it only takes a moment."}
              </div>
            </div>
            <button
              className="ghost-btn"
              onClick={() => checkForNewMusic({ silent: false })}
              disabled={checkingForNewMusic || loadingLibrary}
            >
              {checkingForNewMusic ? "Checking…" : "Check"}
            </button>
          </div>
        )}

        {isNative && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Rescan library</div>
              <div className="settings-row-sub">
                {loadingLibrary
                  ? libraryProgress
                    ? `Scanning… ${libraryProgress.done}/${libraryProgress.total}`
                    : "Scanning…"
                  : "The library loads from a saved cache on launch — rescan after adding or removing tracks."}
              </div>
            </div>
            <button className="ghost-btn" onClick={pickNativeFolder} disabled={loadingLibrary}>
              {loadingLibrary ? "Scanning…" : "Rescan"}
            </button>
          </div>
        )}

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Albums loaded</div>
            <div className="settings-row-sub">{library?.length || 0} tracks total</div>
          </div>
          <div className="settings-row-value">{albums?.length || 0}</div>
        </div>

        {isNative && (
          <div className="settings-row settings-row-tappable" onClick={onOpenReviewTracks}>
            <div>
              <div className="settings-row-label">Possibly not music</div>
              <div className="settings-row-sub">
                {pendingReviewCount > 0
                  ? `${pendingReviewCount} short, untagged file${pendingReviewCount === 1 ? "" : "s"} awaiting review`
                  : "Nothing awaiting review"}
              </div>
            </div>
            {pendingReviewCount > 0 && <div className="settings-row-value">{pendingReviewCount}</div>}
          </div>
        )}
      </div>

      {isNative && (
        <div>
          <div className="settings-group-title">Background Playback</div>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="settings-row-label">If playback keeps stopping when the screen turns off</div>
            <div className="settings-row-sub">{BACKGROUND_PLAYBACK_GUIDANCE.primary}</div>
            <div className="settings-row-sub">{BACKGROUND_PLAYBACK_GUIDANCE.secondary}</div>
          </div>
        </div>
      )}

      <div>
        <div className="settings-group-title">Appearance</div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Theme</div>
            <div className="settings-row-sub">Liquid Glass or Matte Obsidian</div>
          </div>
          <div className="theme-switch">
            <button
              className={theme !== "obsidian" ? "active" : ""}
              onClick={() => setTheme("glass")}
            >
              Glass
            </button>
            <button
              className={theme === "obsidian" ? "active" : ""}
              onClick={() => setTheme("obsidian")}
            >
              Obsidian
            </button>
          </div>
        </div>

        <div className="settings-row settings-row-tappable" onClick={() => setFontPickerOpen(true)}>
          <div>
            <div className="settings-row-label">Typeface</div>
            <div className="settings-row-sub">{currentFontLabel}</div>
          </div>
          <button className="ghost-btn" onClick={(e) => { e.stopPropagation(); setFontPickerOpen(true); }}>
            <Type size={14} style={{ marginRight: 6 }} />
            Change
          </button>
        </div>
      </div>

      <div>
        <div className="settings-group-title">Transport Buttons</div>
        <div className="settings-row-sub" style={{ marginBottom: 12 }}>
          Shape and size change per pack. Color always follows your theme and
          the current album's accent — no pack has its own colors.
        </div>

        <div className="pack-list">
          {Object.entries(BUTTON_PACKS).map(([id, pack]) => (
            <button
              key={id}
              className={`pack-row ${buttonPack === id ? "pack-active" : ""}`}
              onClick={() => setButtonPack(id)}
            >
              <div className="pack-preview">
                <PackPreview pack={pack} />
              </div>
              <div className="pack-meta">
                <div className="pack-name">{pack.name}</div>
                <div className="pack-desc">{pack.desc}</div>
              </div>
              {buttonPack === id && <Check size={16} className="pack-check" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="settings-group-title">About</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">uPod</div>
            <div className="settings-row-sub">it's all about you!</div>
          </div>
        </div>
      </div>

      {fontPickerOpen && <FontPickerModal onClose={() => setFontPickerOpen(false)} />}
    </div>
  );
}

