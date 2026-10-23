// src/utils/accentColor.js
// Extracts a pleasant accent color from cover art via canvas pixel sampling.
// No new dependencies — plain 2D canvas + getImageData.
//
// Approach: downscale the image to a small canvas (cheap to sample), walk
// every pixel, convert to HSL, and throw out pixels that would make an ugly
// accent — near-black, near-white, and near-gray (low saturation, since
// averaging grayscale pixels just produces mud). Among what's left, take a
// saturation-weighted circular mean of hue (circular because hue wraps at
// 360°, a plain average of e.g. 10° and 350° would wrongly give 180°), then
// clamp the final saturation/lightness into a range that looks good as a UI
// accent (not neon, not washed out) rather than reproducing the image's
// exact — possibly extreme — statistics.

// uPod's brand accent: the vivid pink/magenta the launcher icon and splash
// are built from. Used before any cover has been analysed (first launch,
// nothing playing) and whenever extraction can't find a usable hue —
// never a substitute for the per-track dynamic accent, which still takes
// over the moment a track with artwork starts.
const FALLBACK_ACCENT = "#EC4899";

// Immersive mode dims the cover before washing it with the accent. A single
// fixed multiplier can't serve a whole library: measured on device, a pale
// sleeve at brightness(0.54) landed in the right band while a dark
// photographic cover collapsed to a 3-point tonal spread — flat mud with no
// detail left. So the multiplier is computed per cover instead, to bring
// every one of them to roughly the same mean luminance.
//
// MAX is 1 because brightening a dark cover is not the goal — it would just
// amplify its noise and wash out the accent. A dark cover simply isn't
// dimmed, and the tint plus vignette do the rest.
const ART_TARGET_LUMA = 0.42;
const ART_DIM_MIN = 0.45;
const ART_DIM_MAX = 1;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break;
      case g: h = 60 * ((b - r) / d + 2); break;
      case b: h = 60 * ((r - g) / d + 4); break;
    }
  }
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Returns { accent, dim } for a cover-art data URL: the extracted accent
 * hex (or the app's default if extraction fails or the art has nothing
 * usable, e.g. a solid near-black or near-white cover), and the brightness
 * multiplier immersive mode should apply to this particular cover.
 *
 * Both come out of the same single downscale-and-walk — the luminance mean
 * is accumulated over EVERY opaque pixel, deliberately unlike the accent,
 * which throws away near-black/near-white/near-gray pixels. For "how bright
 * is this image actually" those discarded pixels are exactly the ones that
 * matter.
 */
export async function extractCoverAppearance(coverDataUrl) {
  if (!coverDataUrl) return { accent: FALLBACK_ACCENT, dim: 1 };

  try {
    const img = await loadImage(coverDataUrl);
    const SIZE = 32; // small on purpose — this only needs to be roughly right
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    let sumSin = 0, sumCos = 0, sumSat = 0, sumLight = 0, weight = 0;
    let sumLuma = 0, lumaCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue; // skip transparent pixels

      // Rec. 709 luma, over every pixel including the ones the accent
      // filter below discards.
      sumLuma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumaCount += 1;

      const [h, s, l] = rgbToHsl(r, g, b);

      // Skip pixels that would drag the result toward black/white/gray —
      // these carry little "color identity" and averaging them in just
      // produces a muddy, unpleasant accent.
      if (l < 0.10 || l > 0.90) continue;
      if (s < 0.15) continue;

      const w = s; // weight by saturation: vivid pixels count more
      const rad = (h * Math.PI) / 180;
      sumSin += Math.sin(rad) * w;
      sumCos += Math.cos(rad) * w;
      sumSat += s * w;
      sumLight += l * w;
      weight += w;
    }

    const meanLuma = lumaCount ? sumLuma / lumaCount : 0.5;
    const dim = Math.max(
      ART_DIM_MIN,
      Math.min(ART_DIM_MAX, ART_TARGET_LUMA / Math.max(meanLuma, 0.02))
    );

    if (weight === 0) return { accent: FALLBACK_ACCENT, dim };

    let hue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    const avgSat = sumSat / weight;
    const avgLight = sumLight / weight;

    // Clamp into a range that reliably looks good as a UI accent against
    // both the Glass and Obsidian themes, rather than trusting whatever
    // the image's raw statistics happened to be.
    const finalSat = Math.max(0.45, Math.min(0.75, avgSat));
    const finalLight = Math.max(0.42, Math.min(0.62, avgLight));

    return { accent: hslToHex(hue, finalSat, finalLight), dim };
  } catch {
    return { accent: FALLBACK_ACCENT, dim: 1 };
  }
}

// --- Contrast-safe variants -------------------------------------------
//
// The extracted accent is chosen to look good, which is not the same as
// being readable. Two things go wrong, and both were measured on real
// screens rather than assumed:
//
//   - accent as TEXT on the page background. A cover that yields a deep
//     magenta (L≈0.42) reads at 2.8:1 on Matte Obsidian — the Play Now
//     stat figures were effectively unreadable on a dark track.
//   - white text on an accent FILL. uPod's own pink at #EC4899 carries
//     white at 3.53:1, under the 4.5:1 small-text threshold, which is
//     every primary button and the selected tab.
//
// So the accent is published as three variables rather than one:
// --accent (unchanged — fills, borders, sliders, anything that isn't
// carrying text), --accent-text (lightened or darkened until it clears
// 4.5:1 against this theme's background), and --accent-fill (adjusted
// until white text on it clears 4.5:1). Nothing clamps the hue, so the
// per-track identity survives; only lightness moves.

const THEME_BG = { glass: "#E7EAF5", obsidian: "#0A0A0C" };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const MIN_CONTRAST = 4.5;
// The text variant aims higher than the 4.5:1 it has to hit, because the
// background it is measured against (the theme's page colour) is not
// always the background it lands on: panels, cards and list rows sit a
// few percent lighter than the page on Obsidian, and an accent tuned to
// exactly 4.5:1 against the page measured 4.07:1 on a panel. The extra
// headroom covers every surface in the app rather than the darkest one.
const MIN_TEXT_CONTRAST = 5.3;

// Walks the accent's lightness in `step` increments until it clears
// `minContrast` against `against`, keeping hue and saturation. Capped so
// a hopeless case degrades to near-black/near-white rather than looping.
function shiftUntilReadable(hex, against, step, minContrast = MIN_CONTRAST) {
  const rgb = hexToRgb(hex);
  const target = hexToRgb(against);
  if (!rgb || !target) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  let lightness = l;
  for (let i = 0; i < 40; i++) {
    const candidate = hslToHex(h, s, lightness);
    if (contrast(hexToRgb(candidate), target) >= minContrast) return candidate;
    lightness += step;
    if (lightness <= 0 || lightness >= 1) break;
  }
  return hslToHex(h, s, Math.max(0, Math.min(1, lightness)));
}

// The accent, made readable as text on the given theme's background.
export function accentTextColor(hex, theme) {
  const bg = THEME_BG[theme] || THEME_BG.glass;
  // Dark background: lighten towards readable. Light background: darken.
  return shiftUntilReadable(hex, bg, theme === "obsidian" ? 0.03 : -0.03, MIN_TEXT_CONTRAST);
}

// The accent, made dark enough that white text sits on it legibly. Always
// darkens — lightening would eventually turn the fill white and the label
// with it.
export function accentFillColor(hex) {
  return shiftUntilReadable(hex, "#FFFFFF", -0.03);
}

export { FALLBACK_ACCENT };
