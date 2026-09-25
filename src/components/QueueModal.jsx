import React, { useState } from "react";
import { X, ChevronUp, ChevronDown, Trash2, GripVertical, Shuffle, ListPlus, Check } from "lucide-react";
import NoteMark from "./NoteMark";
import { usePlayerState, usePlayerActions } from "../store/PlayerContext";
import useBackButtonClose from "../utils/useBackButtonClose";
import useDragReorder from "../utils/useDragReorder";

// Gap between rows (.queue-list's own `gap`), needed by the drag to work
// out how far a displaced row has to travel to sit where its neighbour
// was. The interaction itself lives in useDragReorder — this list is
// where it was first built, and it is unchanged by the move.
const ROW_GAP_PX = 4;

export default function QueueModal({ onClose }) {
  useBackButtonClose(onClose);
  const { queue, queueIndex } = usePlayerState();
  const { moveQueueItem, removeQueueItem, jumpToQueueIndex, reshuffleQueue, saveQueueAsPlaylist } = usePlayerActions();
  const [savingAs, setSavingAs] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const { draggingIndex, listRef, setRowRef, gripProps } = useDragReorder({
    count: queue.length,
    gap: ROW_GAP_PX,
    onReorder: moveQueueItem,
  });

  const moveUp = (index) => index > 0 && moveQueueItem(index, index - 1);
  const moveDown = (index) => index < queue.length - 1 && moveQueueItem(index, index + 1);

  function handleSaveAs() {
    const name = nameDraft.trim();
    if (!name) return;
    saveQueueAsPlaylist(name);
    setSavingAs(false);
    setNameDraft("");
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal queue-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Queue</div>
          <button className="icon-btn small" onClick={onClose} aria-label="Close queue">
            <X size={16} />
          </button>
        </div>

        <div className="queue-toolbar">
          <button className="pill-btn" onClick={reshuffleQueue} disabled={queue.length < 2}>
            <Shuffle size={13} /> Reshuffle
          </button>
          {!savingAs ? (
            <button className="pill-btn" onClick={() => setSavingAs(true)} disabled={queue.length === 0}>
              <ListPlus size={13} /> Save as playlist
            </button>
          ) : (
            <div className="queue-save-as-row">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAs()}
                placeholder="Playlist name…"
              />
              <button className="icon-btn small" onClick={handleSaveAs} aria-label="Save"><Check size={14} /></button>
            </div>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="empty-state">Nothing queued yet.</div>
        ) : (
          <div className={`queue-list${draggingIndex !== null ? " queue-list-dragging" : ""}`} ref={listRef}>
            {queue.map((track, index) => {
              const isCurrent = index === queueIndex;
              return (
                <div
                  key={`${track.id ?? track.title}-${index}`}
                  ref={setRowRef(index)}
                  className={`queue-row${isCurrent ? " queue-current" : ""}${draggingIndex === index ? " queue-row-lifted" : ""}`}
                >
                  {/* The grip was already here as an affordance; it's the
                      real handle now. The up/down buttons on the right are
                      untouched — dragging is an addition, not a
                      replacement, and tapping still works for anyone who
                      prefers it. */}
                  <button
                    className="queue-grip"
                    {...gripProps(index)}
                    aria-label={`Reorder ${track.title || "track"} — hold and drag`}
                    title="Hold and drag to reorder"
                  >
                    <GripVertical size={14} />
                  </button>

                  <button className="queue-row-main" onClick={() => jumpToQueueIndex(index)}>
                    <div className="queue-row-title">
                      {track.cover ? (
                        <img
                          src={track.cover}
                          alt=""
                          style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                        />
                      ) : (
                        <NoteMark size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {track.title || "Untitled"}
                      </span>
                      {isCurrent && <span className="queue-now-badge">Now</span>}
                    </div>
                    <div className="queue-row-sub">{track.artist || "Unknown artist"}</div>
                  </button>

                  <div className="queue-row-actions">
                    <button
                      className="icon-btn small"
                      disabled={index === 0}
                      onClick={() => moveUp(index)}
                      aria-label="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className="icon-btn small"
                      disabled={index === queue.length - 1}
                      onClick={() => moveDown(index)}
                      aria-label="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      className="icon-btn small"
                      onClick={() => removeQueueItem(index)}
                      aria-label="Remove from queue"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
