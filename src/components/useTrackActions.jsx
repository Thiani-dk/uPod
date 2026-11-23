// src/components/useTrackActions.jsx
// One track-actions menu for the whole app, plus the modals it opens.
//
// Lifted out of Library for the same reason useBulkSelect was: the menu
// and its four follow-on sheets (Add to playlist, Edit, Clean up, Delete)
// were wired up in exactly one screen, so every other track row either
// exposed a smaller hand-picked set of icon buttons or nothing at all. A
// screen now says "these rows are tracks, a tap does this" and gets the
// full menu; it does not get to choose which rows of it exist.
//
// THE GESTURE MAP — the one thing a caller has to get right:
//
//   Tracks tab, Album detail   hold = bulk-select (useBulkSelect).
//                              The menu opens by TAPPING the row's ⋯
//                              button. Do NOT spread menuRowProps here:
//                              two holds on one row fight each other.
//   Playlist detail            hold on the row body = menu. The grip
//                              handle owns drag, the row body is free.
//   Search results             hold = menu. Nothing else claims it.
//
// ...plus right-click on all four, via menuContextProps, which collides
// with nothing because no screen binds the secondary button. A hold is a
// touch gesture — with a mouse it is just a wait, and on the two screens
// whose hold belongs to bulk-select there was no gesture at all, only the
// ⋯ button. See the device gating on menuContextProps below.
//
// Either way it is the same menu with the same rows, so which gesture a
// screen can afford never changes what's reachable from it.
import React, { useCallback, useState } from "react";
import { usePlayerActions } from "../store/PlayerContext";
import { useNav } from "../utils/navigation";
import useLongPressMenu from "../utils/useLongPressMenu";
import TrackActionsMenu from "./TrackActionsMenu";
import AddToPlaylistModal from "./AddToPlaylistModal";
import MetadataEditModal from "./MetadataEditModal";
import MetadataCleaner from "./MetadataCleaner";

// `onPlay` is the one genuinely per-screen action: the menu's Play means
// "play this the way this screen plays things" — a random mix from the
// Tracks tab, the album in order from Album detail, the playlist in order
// from Playlist detail. Everything else in the menu is global.
export default function useTrackActions({ onPlay }) {
  const { commitCleanerResult } = usePlayerActions();
  const { openAlbum, openArtist } = useNav();

  const [menuTrack, setMenuTrack] = useState(null);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null);
  const [editTrack, setEditTrack] = useState(null);
  const [cleanTrack, setCleanTrack] = useState(null);

  const openMenu = useCallback((track) => setMenuTrack(track), []);

  // For the screens that can afford a hold. Call as
  // menuRowProps(track, () => playThisRow(track)).
  const menuRowProps = useLongPressMenu(openMenu);

  // A mouse's equivalent of the hold, safe on every screen including the
  // two that bulk-select. Spread it AFTER rowProps/menuRowProps: those
  // carry an onContextMenu of their own (suppressing the browser's menu)
  // and React keeps only the last one for a given prop.
  const menuContextProps = useCallback(
    (track) => ({
      onContextMenu: (e) => {
        // Unconditional: the native menu is never what's wanted on a
        // track row, whichever device raised the event.
        e.preventDefault();
        // A touch long-press raises contextmenu too. Letting that through
        // would reintroduce the exact bulk-select collision the ⋯ button
        // exists to avoid, so the event has to prove it came from a mouse
        // — first from the event itself (Chrome reports the originating
        // device here), then, for engines that don't say, from the
        // presence of a precise pointer at all. A touchscreen laptop
        // therefore gets right-click AND keeps its hold for selecting.
        if (e.pointerType) {
          if (e.pointerType !== "mouse") return;
        } else if (!window.matchMedia?.("(pointer: fine)").matches) {
          return;
        }
        openMenu(track);
      },
    }),
    [openMenu]
  );

  const overlays = (
    <>
      {menuTrack && (
        <TrackActionsMenu
          track={menuTrack}
          onClose={() => setMenuTrack(null)}
          onPlay={onPlay}
          onOpenAlbum={openAlbum}
          onFilterArtist={openArtist}
          onAddToPlaylist={setAddToPlaylistTrack}
          onEdit={setEditTrack}
          onClean={setCleanTrack}
        />
      )}
      {addToPlaylistTrack && (
        <AddToPlaylistModal track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      )}
      {editTrack && <MetadataEditModal track={editTrack} onClose={() => setEditTrack(null)} />}
      {cleanTrack && (
        <MetadataCleaner
          track={cleanTrack}
          onClose={() => setCleanTrack(null)}
          onCommit={(record) => commitCleanerResult(cleanTrack.id, record)}
        />
      )}
    </>
  );

  return { openMenu, menuRowProps, menuContextProps, overlays };
}
