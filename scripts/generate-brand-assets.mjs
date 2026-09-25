// Generates the source images @capacitor/assets turns into launcher icons
// and splash screens, straight from NoteMark's own geometry — the paths
// below are copied verbatim from src/components/NoteMark.jsx, so the
// launcher icon is the same mark as the sidebar's .brand-mark rather
// than a lookalike drawn by hand.
//
// Run:  node scripts/generate-brand-assets.mjs && npx capacitor-assets generate --android
//
// Colours match the app's own identity: the brand pink (FALLBACK_ACCENT
// in src/utils/accentColor.js) over the obsidian background (--bg in
// global.css), with the icon background reproducing .brand-mark's
// 155deg accent→darkened-accent gradient.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const ACCENT = "#EC4899";
const ACCENT_DARK = "#5E1D3D"; // color-mix(in srgb, #EC4899 40%, #000)
const OBSIDIAN = "#0A0A0C";

// viewBox and paths lifted from NoteMark.jsx.
const MARK_VIEWBOX = { w: 480, h: 520 };
const MARK_PATHS = (fill) => `
  <g fill="${fill}">
    <ellipse cx="105" cy="90" rx="98" ry="60" transform="rotate(-18 105 90)" />
    <ellipse cx="378" cy="64" rx="92" ry="58" transform="rotate(-18 378 64)" />
    <polygon points="40,98 80,82 80,458 40,472" />
    <polygon points="306,70 346,54 346,432 306,446" />
    <polygon points="40,472 346,432 346,396 40,436" />
  </g>`;

// Lays the mark out centred on a square canvas, scaled so its taller
// axis occupies `fraction` of the canvas.
function markSvg({ size, fraction, fill, background }) {
  const h = size * fraction;
  const w = (h * MARK_VIEWBOX.w) / MARK_VIEWBOX.h;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const scale = h / MARK_VIEWBOX.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${background || ""}
    <g transform="translate(${x} ${y}) scale(${scale})">${MARK_PATHS(fill)}</g>
  </svg>`;
}

const gradientBackground = (size) => `
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="0.62" y2="1">
      <stop offset="0" stop-color="${ACCENT}" />
      <stop offset="1" stop-color="${ACCENT_DARK}" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#brand)" />`;

const flatBackground = (size, color) => `<rect width="${size}" height="${size}" fill="${color}" />`;

async function write(name, svg) {
  await sharp(Buffer.from(svg)).png().toFile(`assets/${name}`);
  console.log("wrote assets/" + name);
}

await mkdir("assets", { recursive: true });

// Legacy square icon: mark on the brand gradient.
await write("icon-only.png", markSvg({ size: 1024, fraction: 0.5, fill: "#FFFFFF", background: gradientBackground(1024) }));

// Adaptive icon layers. The foreground is deliberately smaller: Android
// crops an adaptive icon to as little as the inner 66/108 of the canvas
// depending on launcher mask, so anything larger risks losing a notehead.
await write("icon-foreground.png", markSvg({ size: 1024, fraction: 0.4, fill: "#FFFFFF" }));
await write("icon-background.png", markSvg({ size: 1024, fraction: 0, fill: "none", background: gradientBackground(1024) }));

// Splash: the pink mark alone on the app's own obsidian background, so
// the handoff from splash to a launched app is a colour match rather
// than a flash. Both variants are dark on purpose — it matches
// SplashScreen.backgroundColor in capacitor.config.json whichever way
// the system theme is set.
for (const name of ["splash.png", "splash-dark.png"]) {
  await write(name, markSvg({ size: 2732, fraction: 0.16, fill: ACCENT, background: flatBackground(2732, OBSIDIAN) }));
}
