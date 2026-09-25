// src/components/BulkActionBar.jsx
// The bar that appears once a selection exists, plus the commit itself:
// the whole selection goes through the existing Select Playlist popup in
// one action — same sheet, same "New playlist…" row, just handed a list
// instead of a single track.
//
// `pool` is the track list the ids were selected from, so this can hand
// AddToPlaylistModal real track objects rather than bare ids.
import React, { useState } from "react";
import { X, ListPlus } from "lucide-react";
import AddToPlaylistModal from "./AddToPlaylistModal";

export default function BulkActionBar({ selectedIds, pool, onClear }) {
  const [addingTracks, setAddingTracks] = useState(null);
  if (!selectedIds || selectedIds.size === 0) return null;

  return (
    <>
      <div className="bulk-action-bar">
        <span className="bulk-action-count">{selectedIds.size} selected</span>
        <button className="pill-btn" onClick={() => setAddingTracks(pool.filter((t) => selectedIds.has(t.id)))}>
          <ListPlus size={13} /> Add to playlist
        </button>
        <button className="icon-btn small" onClick={onClear} aria-label="Cancel selection">
          <X size={15} />
        </button>
      </div>
      {addingTracks && (
        <AddToPlaylistModal
          tracks={addingTracks}
          // Committing ends the mode — leaving the rows checked after
          // they've been filed somewhere invites adding them twice.
          onClose={() => { setAddingTracks(null); onClear(); }}
        />
      )}
    </>
  );
}
