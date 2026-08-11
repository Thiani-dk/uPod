# uPod — Batch 4: Immersive Now Playing

## Files in this zip
```
src/
  screens/
    NowPlaying.jsx   ← MODIFIED: adds immersive mode (full replacement)
  styles/
    global.css       ← MODIFIED: full replacement, batch3 content + new
                        .np-immersive* rules appended at the end
```

## What changed
- Tap the small expand icon (top-right corner of the album art) on the
  normal Now Playing screen to enter immersive mode. Tap the icon
  top-right in immersive mode to exit back.
- Immersive mode: full-bleed cover art, grayscaled and tinted with
  `var(--accent)` via `mix-blend-mode: color` (duotone look from your
  screenshot, no canvas/pixel-sampling needed — this is separate from
  gap item 4, the *dynamic* accent, and will look correct automatically
  once that lands).
- Dark scrim gradient at the bottom so title/controls stay legible.
- Same real `TransportButtons` component as the normal screen (shuffle,
  back, play/pause, forward, repeat) — restyled white for the dark
  background, not reimplemented. This means play state, shuffle, and
  repeat stay perfectly in sync whether you're in immersive mode or not.
- Progress bar and seek behavior reused as-is (same `seek` action).
- Pills consolidated to 3, per your sketch: Lyrics (opens Karaoke),
  a combined Favorite/Info/More capsule, and Queue. Favorite and
  song-info aren't wired to anything yet (they weren't before, either —
  same as the normal screen's plain Favorite/More buttons). EQ isn't in
  the immersive pill row since it wasn't in your mockup; it's still one
  tap away via the normal Now Playing screen.
- At `>=720px` width in landscape orientation, it switches to your
  second screenshot's two-column layout: art fills the left half,
  metadata/pills/progress/transport stack in the right half. Same
  component, just a media query — not a separate screen to maintain.

## One thing to watch for when testing
The duotone tint (`mix-blend-mode: color`) needs the accent to have
real saturation to look right — with the current hardcoded `#8B7CFF`
it should look purple-blue like your mockup. If a future theme or
accent ever ends up near-gray/white, the tint will look washed out;
not a bug, just how `mix-blend-mode: color` behaves with low-saturation
colors — worth keeping in mind whenever gap item 4 (dynamic accent)
gets built.

## Terminal command
```bash
cd ~/Desktop/vibe\ coding/uPod/upod
unzip ~/Downloads/upod-batch4-fixes.zip -d .
```
Say yes (`A`) when it asks to replace `NowPlaying.jsx` and `global.css`.

## Still not done (unchanged gap list minus item 6, now closed)
4. Dynamic accent color from real cover art (still hardcoded `#8B7CFF`)
8. Library tabs merged (Playlists/Songs + built-in search)
9. Sidebar playlist shortcuts
10. Metadata editing UI
11. Android packaging (SAF folder access replacing `webkitdirectory`)
