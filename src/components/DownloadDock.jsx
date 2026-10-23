// src/components/DownloadDock.jsx
// The download indicator. Replaces the earlier flat progress strip,
// which was a bar and a percentage and read like a system message
// rather than part of uPod.
//
// The idea here is a spinning record: the disc turns while the download
// runs, a progress ring closes around it, and the whole card settles
// into a quiet "saved" state when it lands. The disc is the same
// gesture as the rest of the app (Disc3 is already the Now Playing
// icon), so a download looks like something this music player is doing
// rather than a download manager bolted on.
import React from "react";
import { X, Check, TriangleAlert, Search } from "lucide-react";

// Circumference of the r=18 ring below; the dash offset is driven off
// it to turn a 0-100 percentage into an arc.
const RING = 2 * Math.PI * 18;

function etaText(seconds) {
  if (seconds == null || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  return `${Math.round(seconds / 60)}m left`;
}

function DiscRing({ percent, known, state }) {
  // An unknown total still has to look like motion, so the ring spins as
  // a fixed arc instead of sitting at zero pretending to be stalled.
  const dash = known ? (Math.min(100, Math.max(0, percent)) / 100) * RING : RING * 0.25;

  return (
    <div className={`dock-disc dock-disc-${state}`}>
      <svg className="dock-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="dock-ring-track" cx="22" cy="22" r="18" />
        <circle
          className={`dock-ring-fill ${known ? "" : "is-indeterminate"}`}
          cx="22"
          cy="22"
          r="18"
          style={{ strokeDasharray: `${dash} ${RING}` }}
        />
      </svg>
      <div className="dock-disc-face">
        {state === "failed" ? (
          <TriangleAlert size={15} />
        ) : state === "done" ? (
          <Check size={15} />
        ) : state === "searching" ? (
          <Search size={13} />
        ) : (
          <span className="dock-disc-hole" />
        )}
      </div>
    </div>
  );
}

export default function DownloadDock({ downloads, onDismiss, aboveMiniPlayer }) {
  if (downloads.length === 0) return null;

  return (
    <div className={`dl-dock ${aboveMiniPlayer ? "above-mini-player" : ""}`}>
      {downloads.map((d) => {
        const state = d.status === "failed" ? "failed" : d.status === "done" ? "done" : d.status === "searching" ? "searching" : "running";
        const known = typeof d.percent === "number" && d.percent >= 0;
        const eta = etaText(d.etaSeconds);

        return (
          <div key={d.id} className={`dl-card is-${state}`}>
            <DiscRing percent={d.percent} known={known} state={state} />

            <div className="dl-card-body">
              <div className="dl-card-title">{d.label}</div>
              <div className="dl-card-sub">
                {state === "failed"
                  ? d.message
                  : state === "done"
                    ? "Saved to your music folder"
                    : state === "searching"
                      ? "Finding this on YouTube…"
                      : known
                        ? `${Math.round(d.percent)}%${eta ? ` · ${eta}` : ""}`
                        : "Downloading…"}
              </div>
            </div>

            {/* Only a settled row can be dismissed — hiding a live
                download would leave it running unaccounted for. */}
            {(state === "failed" || state === "done") && (
              <button className="dl-card-close" onClick={() => onDismiss(d.id)} aria-label="Dismiss">
                <X size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
