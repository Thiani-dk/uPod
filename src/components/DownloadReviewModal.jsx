// src/components/DownloadReviewModal.jsx
// What arrived, and what it should be called.
//
// The problem this solves: share an artist's playlist into uPod and you
// get a folder of correct audio files that the library has no way to
// read as one record. YouTube rarely tags a rip with an album, and the
// library keys albums off that tag, so twelve songs from one album
// arrive as twelve albums of one song. The downloader now carries a
// playlist's title and track numbers across where it can (see
// AudioDownloadPlugin's --parse-metadata), but a share is often a loose
// playlist, a mixtape, or three singles at once — and only the person
// who shared it knows which.
//
// So this asks, once, at the only moment the answer is obvious: right
// after the download, while they still remember what they shared.
//
// Everything it writes is in-app metadata (the same store the cleaner
// and the hand-editor write to), never a change to the files on disk —
// the same constraint every other edit in uPod operates under.
import React, { useMemo, useRef, useState } from "react";
import { X, ImagePlus, Disc3, Layers, FileMusic } from "lucide-react";
import { usePlayerActions, usePlayerState } from "../store/PlayerContext";
import { normalizeKey } from "../audio/metadata";
import useBackButtonClose from "../utils/useBackButtonClose";
import NoteMark from "./NoteMark";

// The three answers. "single" is first and is the default, because
// leaving things alone must never be the option you have to go looking
// for — plenty of shares really are one track.
const MODES = [
  { id: "single", label: "As is", icon: FileMusic, hint: "Keep each track on its own" },
  { id: "new", label: "New album", icon: Disc3, hint: "Bundle them into one new album" },
  { id: "existing", label: "Existing album", icon: Layers, hint: "File them into an album you already have" },
];

// A reasonable album name to start from, in descending order of how much
// it is worth: what the downloader already wrote into the files (a
// playlist title, usually), then the playlist name the share reported,
// then nothing — an empty box the user fills in, rather than a guess
// dressed up as an answer.
function suggestedAlbumName(tracks, playlist) {
  const tagged = tracks.find((t) => t.hasAlbumTag)?.album;
  if (tagged) return tagged;
  return playlist || "";
}

function suggestedArtist(tracks) {
  const counts = new Map();
  for (const t of tracks) {
    const name = (t.albumArtist || t.artist || "").trim();
    if (name && name !== "Unknown Artist") counts.set(name, (counts.get(name) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : "";
}

// `onDone(saved)` is how the two callers differ. For a fresh download
// (App.jsx) finishing either way retires the pending batch; for a
// selection the user made by hand (BulkActionBar) it ends the selection
// mode. The sheet itself doesn't need to know which it is.
export default function DownloadReviewModal({ tracks, playlist, heading, onDone }) {
  useBackButtonClose(() => onDone(false));
  const { albums } = usePlayerState();
  const { describeDownloadedTrack, setAlbumCoverOverride } = usePlayerActions();

  const [mode, setMode] = useState("single");
  const [albumName, setAlbumName] = useState(() => suggestedAlbumName(tracks, playlist));
  const [albumArtist, setAlbumArtist] = useState(() => suggestedArtist(tracks));
  const [existingAlbumId, setExistingAlbumId] = useState("");
  // { bytes, format, url } for a cover the user picked here, or null to
  // leave whatever the files already carry.
  const [cover, setCover] = useState(null);
  const [edits, setEdits] = useState(() =>
    tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist }))
  );
  const [saving, setSaving] = useState(false);
  const coverInputRef = useRef(null);

  // Only real albums can be filed into — a "single::<id>" entry is one
  // loose track that the library is displaying as an album, and merging
  // into one of those would mean inventing an album name anyway.
  const realAlbums = useMemo(
    () => albums.filter((a) => !a.id.startsWith("single::")).sort((a, b) => a.title.localeCompare(b.title)),
    [albums]
  );

  const chosenAlbum = realAlbums.find((a) => a.id === existingAlbumId) || null;
  const targetAlbumName = mode === "new" ? albumName.trim() : mode === "existing" ? chosenAlbum?.title || "" : "";
  const canSave =
    !saving &&
    (mode === "single" || (mode === "new" && albumName.trim().length > 0) || (mode === "existing" && chosenAlbum));

  function patchEdit(id, patch) {
    setEdits((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function handleCoverFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = file.type || "image/jpeg";
    setCover((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return { bytes, format, url: URL.createObjectURL(new Blob([bytes], { type: format })) };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const edit = edits.find((e) => e.id === track.id);
        await describeDownloadedTrack(track.id, {
          title: edit?.title?.trim() || track.title,
          artist: edit?.artist?.trim() || track.artist,
          // In album mode every track gets the same album name, which is
          // exactly what makes the library group them: album identity is
          // the normalized album tag (see albumIdForTrack).
          album: targetAlbumName || null,
          // Only set when the user actually named one, so filing into an
          // existing album inherits that album's artist instead of
          // stamping every appended track with a guess.
          ...(mode === "new" && albumArtist.trim() ? { albumArtist: albumArtist.trim() } : {}),
          // Numbered by the order shown here. An album whose tracks all
          // report "0" sorts alphabetically, which is nobody's running
          // order; filing them into an existing album leaves the numbers
          // alone, since that album already has an order of its own and
          // appended tracks shouldn't claim positions 1..n in it.
          ...(mode === "new" ? { track: i + 1 } : {}),
        });
      }

      if (cover) {
        // One cover for the group in album mode; in "as is" mode each
        // track is its own one-track album, so the same image is applied
        // to each — the user picked a cover for what they just
        // downloaded, and that is all of it.
        const albumIds =
          mode === "single" ? tracks.map((t) => `single::${t.id}`) : [normalizeKey(targetAlbumName)];
        for (const albumId of albumIds) {
          setAlbumCoverOverride(albumId, cover.bytes, cover.format);
        }
      }

      onDone(true);
    } finally {
      setSaving(false);
    }
  }

  const previewCover = cover?.url || tracks.find((t) => t.cover)?.cover || null;

  return (
    <div className="modal-overlay" onClick={() => onDone(false)}>
      <div className="modal-sheet modal-sheet-solid arrival-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            {heading || (tracks.length === 1 ? "1 track arrived" : `${tracks.length} tracks arrived`)}
          </h3>
          <button className="modal-close-btn" onClick={() => onDone(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="arrival-sheet-scroll">
          <div className="arrival-cover-row">
            <div
              className={`arrival-cover ${previewCover ? "" : "cover-glass"}`}
              style={previewCover ? { background: `url(${previewCover}) center/cover` } : undefined}
            >
              {!previewCover && <NoteMark size={30} style={{ color: "var(--accent-text)" }} />}
            </div>
            <div className="arrival-cover-text">
              <div className="arrival-cover-title">Cover art</div>
              <div className="settings-row-sub">
                {cover
                  ? "Your picture will be used for these tracks."
                  : "A YouTube rip usually arrives with the video thumbnail, or nothing at all."}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleCoverFile}
              />
              <button className="pill-btn" onClick={() => coverInputRef.current.click()}>
                <ImagePlus size={13} /> {cover ? "Choose another" : "Choose a picture"}
              </button>
            </div>
          </div>

          <div className="arrival-modes">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  className={`arrival-mode ${mode === m.id ? "is-active" : ""}`}
                  onClick={() => setMode(m.id)}
                >
                  <Icon size={15} />
                  <span className="arrival-mode-label">{m.label}</span>
                </button>
              );
            })}
          </div>
          <div className="settings-row-sub arrival-mode-hint">{MODES.find((m) => m.id === mode).hint}</div>

          {mode === "new" && (
            <div className="edit-form arrival-album-form">
              <label className="edit-field">
                <span>Album name</span>
                <input
                  value={albumName}
                  onChange={(e) => setAlbumName(e.target.value)}
                  placeholder="What is this album called?"
                />
              </label>
              <label className="edit-field">
                <span>Album artist</span>
                <input
                  value={albumArtist}
                  onChange={(e) => setAlbumArtist(e.target.value)}
                  placeholder="Who made it?"
                />
              </label>
            </div>
          )}

          {mode === "existing" && (
            <div className="edit-form arrival-album-form">
              <label className="edit-field">
                <span>Add to</span>
                <select value={existingAlbumId} onChange={(e) => setExistingAlbumId(e.target.value)}>
                  <option value="">Pick an album…</option>
                  {realAlbums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} — {a.artist}
                    </option>
                  ))}
                </select>
              </label>
              {realAlbums.length === 0 && (
                <div className="settings-row-sub">
                  You don't have any tagged albums yet — bundle these into a new one instead.
                </div>
              )}
            </div>
          )}

          <div className="arrival-track-list">
            {tracks.map((t, i) => {
              const edit = edits.find((e) => e.id === t.id);
              return (
                <div key={t.id} className="arrival-track">
                  <span className="arrival-track-n">{mode === "new" ? i + 1 : "•"}</span>
                  <div className="arrival-track-fields">
                    <input
                      className="arrival-track-title"
                      value={edit?.title ?? ""}
                      onChange={(e) => patchEdit(t.id, { title: e.target.value })}
                      placeholder="Title"
                    />
                    <input
                      className="arrival-track-artist"
                      value={edit?.artist ?? ""}
                      onChange={(e) => patchEdit(t.id, { artist: e.target.value })}
                      placeholder="Artist"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="edit-form-note">
            These details apply inside uPod only — the downloaded files themselves aren't rewritten.
          </div>
        </div>

        <div className="arrival-sheet-footer">
          <button className="ghost-btn" onClick={() => onDone(false)}>
            Leave as is
          </button>
          <button className="primary-btn" disabled={!canSave} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
