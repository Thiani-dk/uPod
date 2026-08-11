// src/utils/fonts.js
// Lazy-loads Google Fonts on selection (only the one the user picks, not
// all of them up front) and exposes the CSS font-family stack for each.

export const FONT_OPTIONS = [
  { id: "system", label: "System Font", googleFamily: null, stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: "inter", label: "Inter (default)", googleFamily: "Inter:wght@400;600;700", stack: "'Inter', sans-serif" },
  { id: "roboto", label: "Roboto", googleFamily: "Roboto:wght@400;600;700", stack: "'Roboto', sans-serif" },
  { id: "roboto-condensed", label: "Roboto Condensed", googleFamily: "Roboto+Condensed:wght@400;600;700", stack: "'Roboto Condensed', sans-serif" },
  { id: "roboto-slab", label: "Roboto Slab", googleFamily: "Roboto+Slab:wght@400;600;700", stack: "'Roboto Slab', serif" },
  { id: "nunito-sans", label: "Nunito Sans", googleFamily: "Nunito+Sans:wght@400;600;700", stack: "'Nunito Sans', sans-serif" },
  { id: "pt-sans", label: "PT Sans", googleFamily: "PT+Sans:wght@400;700", stack: "'PT Sans', sans-serif" },
  { id: "source-sans", label: "Source Sans 3", googleFamily: "Source+Sans+3:wght@400;600;700", stack: "'Source Sans 3', sans-serif" },
  { id: "open-sans", label: "Open Sans", googleFamily: "Open+Sans:wght@400;600;700", stack: "'Open Sans', sans-serif" },
  { id: "quicksand", label: "Quicksand", googleFamily: "Quicksand:wght@400;600;700", stack: "'Quicksand', sans-serif" },
  { id: "ubuntu", label: "Ubuntu", googleFamily: "Ubuntu:wght@400;500;700", stack: "'Ubuntu', sans-serif" },
  { id: "play", label: "Play", googleFamily: "Play:wght@400;700", stack: "'Play', sans-serif" },
  { id: "archivo-narrow", label: "Archivo Narrow", googleFamily: "Archivo+Narrow:wght@400;600;700", stack: "'Archivo Narrow', sans-serif" },
  // Circular Std is Spotify's proprietary font and isn't available on
  // Google Fonts or any free source — Poppins is the closest free
  // geometric-rounded substitute.
  { id: "poppins", label: "Poppins (Circular Std alt.)", googleFamily: "Poppins:wght@400;600;700", stack: "'Poppins', sans-serif" },
];

const loadedFamilies = new Set();

export function loadFont(fontId) {
  const font = FONT_OPTIONS.find((f) => f.id === fontId);
  if (!font || !font.googleFamily || loadedFamilies.has(font.googleFamily)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.googleFamily}&display=swap`;
  document.head.appendChild(link);
  loadedFamilies.add(font.googleFamily);
}

export function getFontStack(fontId) {
  return FONT_OPTIONS.find((f) => f.id === fontId)?.stack || FONT_OPTIONS[0].stack;
}
