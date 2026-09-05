// src/screens/ReviewTracks.jsx
// Lists tracks the scanner flagged as possiblyNotMusic (metadata.js) —
// short + completely untagged files, the profile of an unedited voice
// note/call recording that slipped past the filename filter (e.g. it was
// renamed after recording). Never auto-hidden: the user reviews each one
// and either confirms it as real music or excludes it (see
// actions.reviewTrack in PlayerContext.jsx). Already-decided tracks don't
// belong here — the review list only ever shows tracks still awaiting a
// decision.
import React from "react";
import { ChevronLeft, Music, Ban } from "lucide-react";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import NoteMark from "../components/NoteMark";

function formatSize(bytes) {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function ReviewTracks({ onBack }) {
  const { library } = usePlayerState();
  const { reviewTrack } = usePlayerActions();

  const pending = library.filter((t) => t.possiblyNotMusic && !t.reviewStatus);

  return (
    <div className="detail-screen">
      <button className="back-btn" onClick={onBack}>
        <ChevronLeft size={16} /> Settings
      </button>

      <div className="settings-group-title" style={{ marginTop: 8 }}>Possibly not music</div>
      <div className="settings-row-sub" style={{ padding: "0 2px 14px" }}>
        These files are short and have no title, artist, or album tag at all — often a sign of a voice note or
        call recording rather than a song. They're kept out of your library until you decide. Nothing on disk is
        touched by either choice below, and you can change your mind later by excluding or re-confirming a track.
      </div>

      {pending.length === 0 && (
        <div className="empty-state">Nothing to review right now.</div>
      )}

      {pending.length > 0 && (
        <div className="track-list">
          {pending.map((t) => (
            <div key={t.id} className="track-row-wrap track-row-thumb-wrap">
              <div className="track-row-play track-row-with-thumb" style={{ cursor: "default" }}>
                <div className="track-row-thumb cover-glass">
                  <NoteMark size={18} style={{ color: "var(--accent)" }} />
                </div>
                <span className="track-row-text">
                  <span className="track-row-text-title">{t.title}</span>
                  <span className="track-row-text-artist">{formatSize(t.size)}</span>
                </span>
              </div>
              <button
                className="icon-btn small track-edit-btn"
                onClick={() => reviewTrack(t.id, "confirmed")}
                aria-label="Confirm as music"
                title="Confirm as music — add to library"
              >
                <Music size={15} />
              </button>
              <button
                className="icon-btn small track-edit-btn"
                onClick={() => reviewTrack(t.id, "excluded")}
                aria-label="Not music — exclude"
                title="Not music — exclude from library"
              >
                <Ban size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
