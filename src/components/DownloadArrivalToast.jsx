// src/components/DownloadArrivalToast.jsx
// "Your music landed" — the in-app half of the arrival announcement.
// When uPod is in the background the shade gets a notification instead
// (AudioDownloadPlugin.notifyBatchComplete); only ever one of the two,
// because a banner over the app you are already looking at, duplicating
// something you can see, is just noise.
//
// It is deliberately a card rather than a toast strip: it has to carry a
// stack of covers, two actions and a line of text. It reads as part of
// the app rather than as an announcement over it — the same surface,
// border and radius as every other floating panel, in whichever theme
// is on.
//
// It does not auto-dismiss. It is the only way into the review from
// inside the app, and a sheet that offers to sort your new album and
// then silently withdraws the offer after eight seconds is worse than
// one that waits to be answered.
import React from "react";
import { X } from "lucide-react";
import NoteMark from "./NoteMark";

export default function DownloadArrivalToast({ tracks, onReview, onDismiss }) {
  if (!tracks || tracks.length === 0) return null;

  const count = tracks.length;
  // Up to three covers, fanned. More than that reads as clutter at this
  // size and the count already carries the "there are lots" message.
  const stack = tracks.slice(0, 3);
  const names = tracks
    .slice(0, 2)
    .map((t) => t.title)
    .join(", ");

  return (
    <div className="arrival-toast" role="status">
      <div className="arrival-stack" aria-hidden="true">
        {stack.map((t, i) => (
          <div
            key={t.id}
            className={`arrival-stack-cover ${t.cover ? "" : "cover-glass"}`}
            style={{
              // Each sleeve sits a little further back and a little
              // further over, like records being pulled out of a crate.
              "--i": i,
              ...(t.cover ? { background: `url(${t.cover}) center/cover` } : {}),
            }}
          >
            {!t.cover && <NoteMark size={16} style={{ color: "var(--accent-text)" }} />}
          </div>
        ))}
      </div>

      <div className="arrival-toast-body">
        <div className="arrival-toast-title">
          {count === 1 ? "1 track downloaded" : `${count} tracks downloaded`}
        </div>
        <div className="arrival-toast-sub">
          {names}
          {count > 2 ? ` +${count - 2} more` : ""}
        </div>
        <div className="arrival-toast-actions">
          <button className="primary-btn arrival-review-btn" onClick={onReview}>
            Sort them out
          </button>
          <button className="ghost-btn arrival-later-btn" onClick={onDismiss}>
            Leave as is
          </button>
        </div>
      </div>

      <button className="arrival-toast-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
