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

const FALLBACK_ACCENT = "#8B7CFF";

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
 * Returns a hex accent color extracted from a cover-art data URL, or the
 * app's default accent if extraction fails or the art has nothing usable
 * (e.g. a solid near-black or near-white cover).
 */
export async function extractAccentColor(coverDataUrl) {
  if (!coverDataUrl) return FALLBACK_ACCENT;

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

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue; // skip transparent pixels

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

    if (weight === 0) return FALLBACK_ACCENT;

    let hue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    const avgSat = sumSat / weight;
    const avgLight = sumLight / weight;

    // Clamp into a range that reliably looks good as a UI accent against
    // both the Glass and Obsidian themes, rather than trusting whatever
    // the image's raw statistics happened to be.
    const finalSat = Math.max(0.45, Math.min(0.75, avgSat));
    const finalLight = Math.max(0.42, Math.min(0.62, avgLight));

    return hslToHex(hue, finalSat, finalLight);
  } catch {
    return FALLBACK_ACCENT;
  }
}

export { FALLBACK_ACCENT };
