# uPod — Batch 5: Dynamic accent color

## Files in this zip
```
src/
  utils/
    accentColor.js      ← NEW: canvas-based dominant color extraction
  store/
    PlayerContext.jsx   ← MODIFIED: full replacement
  App.jsx                ← MODIFIED: full replacement
```

## What changed
- `accentColor.js` downscales cover art to a 32×32 canvas, samples every
  pixel, throws out anything too dark/light/gray (avoids muddy or ugly
  extracted colors), and takes a saturation-weighted average hue (using
  a circular mean, since hue wraps at 360°). Final saturation/lightness
  are clamped to a range that reads well as a UI accent rather than
  trusting the image's raw statistics.
- Falls back to the old default (`#8B7CFF`) for tracks with no cover art,
  or if extraction fails for any reason.
- `PlayerContext.jsx` now computes this once per track (not per render,
  not per queue mutation) and caches the result in memory by track id —
  skipping back to an already-played track is instant, no re-sampling.
- `App.jsx` reads `state.accentColor` instead of the hardcoded value.
  Nothing else needed to change — every component that uses `var(--accent)`
  (transport buttons, progress bar, immersive duotone tint from batch 4,
  pill badges, etc.) picks this up automatically since it's the same CSS
  variable, just no longer frozen to one color.

## What to expect when testing
- Switching tracks should visibly shift the accent color across the whole
  UI — play/pause button, progress bar fill, immersive Now Playing tint —
  to something sampled from that track's actual cover art.
- Tracks with no embedded cover art keep the old purple `#8B7CFF`.
- The color should never look black, white, or muddy gray — if you find
  one that does, that's useful to flag; the clamping ranges in
  `accentColor.js` (`finalSat`, `finalLight`) are the first thing to tune.

## Terminal command
```bash
cd ~/Desktop/vibe\ coding/uPod/upod
unzip ~/Downloads/upod-batch5-fixes.zip -d .
```
Say yes (`A`) — this adds one new file (`src/utils/accentColor.js`) and
replaces `PlayerContext.jsx` and `App.jsx`.

## Next up
Batch 6 (Library tabs + Sidebar playlist shortcuts) is ready to build
next — already have every file needed.
