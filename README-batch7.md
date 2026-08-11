# uPod — Batch 7: Metadata editing UI

## Files in this zip
```
src/
  audio/
    metadata.js              ← MODIFIED: `normalizeKey` now exported
                                 (needed so album regrouping works
                                 correctly after an edit — see below)
  store/
    PlayerContext.jsx        ← MODIFIED: full replacement, new
                                 UPDATE_TRACK_METADATA action
  components/
    MetadataEditModal.jsx    ← NEW
  screens/
    AlbumDetail.jsx           ← MODIFIED: full replacement, track rows
                                 restructured + edit icon added
  styles/
    global.css                ← MODIFIED: full replacement, new blocks
                                 for the edit modal + restructured track row
```

## What changed
- Every track row in `AlbumDetail.jsx` now has a small pencil icon.
  Tapping it opens a modal to edit Title / Artist / Album / Track #.
- **In-memory only** — same platform constraint as Studio renders and
  track-order fixes: your original file on disk is never touched. The
  modal says this explicitly so it's never a surprise.
- Saving dispatches into `PlayerContext`, which patches `state.library`
  and re-runs `groupIntoAlbums` — so if you change a track's Album field,
  it can genuinely move into a different album (or create a new one),
  the same way it would if the real file's tag had been different from
  the start.
- One real subtlety worth knowing: `groupIntoAlbums` decides which album
  a track belongs to using a precomputed `albumKey` field, not the raw
  album string — so simply changing `track.album` without also
  recomputing `albumKey` would silently do nothing (the stale key wins).
  That's why `normalizeKey` needed to become exported from `metadata.js`
  rather than staying private — `PlayerContext` needs the exact same
  normalization logic MusicBrainz-order-fixing already trusted, not a
  second slightly-different version.
- Manually editing a track's number also marks it `trackConfirmed: true`,
  same as an online MusicBrainz match — so it won't get silently
  overridden later by the "did this number collide with another track"
  heuristic in `groupIntoAlbums`.
- `AlbumDetail.jsx`'s track rows changed structure (a wrapper `div` with
  two buttons — play area + edit icon — instead of one button for the
  whole row) since a `<button>` can't contain another `<button>`.
  Visually identical to before, just now has room for the edit icon.
  `PlaylistDetail.jsx` still uses the old single-button `.track-row` and
  wasn't touched — no metadata editing there yet, only from Library/Album
  view for now.

## Terminal command
```bash
cd ~/Desktop/vibe\ coding/uPod/upod
unzip ~/Downloads/upod-batch7-fixes.zip -d .
```
Say yes (`A`) to all five files (one new, four replaced).

## Gap list status
Metadata editing UI is now the last item built. Only Android packaging
remains — its own dedicated research session, not a code batch.
