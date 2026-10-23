// src/components/DownloadAudioModal.jsx
// What comes up when a link is shared into uPod (Share > uPod — see
// ShareTargetPlugin.java). It asks the one question worth asking before
// a download starts: which audio to pull.
//
// A tap on a row IS the action — picking a quality is already the
// confirmation, so there is no second button to hunt for one-handed.
import React from "react";
import { X, Check, Music4, Disc3, Loader2, TriangleAlert } from "lucide-react";
import { AUDIO_QUALITY_PRESETS, describeSource } from "../download/qualityPresets";
import useBackButtonClose from "../utils/useBackButtonClose";

export default function DownloadAudioModal({ url, resolved, resolving, resolveError, onPick, onClose }) {
  useBackButtonClose(onClose);
  const source = describeSource(url);

  return (
    <div className="modal-overlay dl-overlay" onClick={onClose}>
      <div className="dl-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Grabber: this reads as a sheet you pulled up, and gives the
            eye somewhere to land before the artwork. */}
        <div className="dl-grabber" />

        <div className="dl-head">
          <div className="dl-art">
            {resolved?.cover ? (
              <img src={resolved.cover} alt="" className="dl-art-img" />
            ) : (
              <div className="dl-art-fallback">
                <Disc3 size={26} />
              </div>
            )}
          </div>

          <div className="dl-head-text">
            <span className="dl-source-chip">{source}</span>
            {resolving ? (
              <div className="dl-title dl-title-muted">
                <Loader2 size={14} className="dl-spin" /> Looking that up…
              </div>
            ) : resolved ? (
              <>
                <div className="dl-title">{resolved.title}</div>
                <div className="dl-sub">{resolved.artist}</div>
              </>
            ) : (
              <div className="dl-title">Save audio</div>
            )}
          </div>

          <button className="dl-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* A Spotify link that couldn't be read is still worth
            explaining here rather than failing silently after a tap. */}
        {resolveError && (
          <div className="dl-notice">
            <TriangleAlert size={14} />
            <span>{resolveError}</span>
          </div>
        )}

        <div className="dl-list">
          {AUDIO_QUALITY_PRESETS.map((preset) => (
            <button key={preset.id} className="dl-row" onClick={() => onPick(preset)}>
              <span className="dl-row-icon">
                <Music4 size={16} />
              </span>
              <span className="dl-row-text">
                <span className="dl-row-label">
                  {preset.label}
                  {preset.recommended && <span className="dl-chip">Best</span>}
                </span>
                <span className="dl-row-sub">{preset.sub}</span>
              </span>
              <span className="dl-row-go">
                <Check size={15} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
