# uPod — Batch 6: Library tabs + Sidebar playlist shortcuts

## Files in this zip
```
src/
  screens/
    Library.jsx   ← MODIFIED: full replacement, adds Albums/Playlists/Songs tabs
  components/
    Sidebar.jsx   ← MODIFIED: full replacement, adds playlist shortcuts section
  styles/
    global.css    ← MODIFIED: full replacement, batch5's content + small new
                     block for the sidebar playlist shortcuts appended at end
  App.jsx          ← MODIFIED: full replacement, threads onOpenPlaylist to
                     both Sidebar and Library (previously only Studio could
                     open a playlist)
```

## What changed
- **Library tabs**: Albums / Playlists / Songs, using the `.tab-row`/`.tab-btn`
  CSS that was already sitting unused in `global.css` — no new tab styling
  needed.
- Search now filters whichever tab is active (album title/artist, playlist
  name, or song title/artist), same search bar as before.
- **Playlists tab** reuses the exact row styling from Studio's playlist list
  (`.playlist-row` etc.) so it looks identical whether you got there from
  Studio or Library.
- **Songs tab** is a flat, searchable list of every track. Tapping a song
  finds the album it belongs to and plays it through the same
  `playAlbumFromTrack` path everything else already uses — no second,
  parallel way of starting playback was added.
- **Sidebar playlist shortcuts**: a "Playlists" section appears under the
  main nav (only when at least one playlist exists), each one a tappable
  shortcut straight into `PlaylistDetail`. Scrolls internally if you end up
  with a lot of them, so it doesn't push the theme toggle off-screen.

## One known small quirk, not fixed in this batch
`PlaylistDetail`'s back button always returns to Studio, regardless of
whether you opened the playlist from Studio, Library, or the sidebar. Was
already true before this batch (Studio already opened playlists this way);
now that Library and the sidebar can also get you there, it's more
noticeable. Easy fix (track where you came from) — say the word if you want
it addressed now or bundled into a later batch.

## Terminal command
```bash
cd ~/Desktop/vibe\ coding/uPod/upod
unzip ~/Downloads/upod-batch6-fixes.zip -d .
```
Say yes (`A`) to all four replacements.

## Next up
Batch 7 (metadata editing UI) is ready to build — already have every file
needed (`metadata.js`, `AlbumDetail.jsx`, `PlayerContext.jsx`).
