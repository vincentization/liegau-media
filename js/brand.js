// Vereins-Branding: Farben, Schrift, Logos. Eine Quelle für alle Views.

export const COLORS = {
  green: '#3e9800',      // Akzent Website
  greenDark: '#33691e',  // Logo dunkelgrün
  greenLight: '#76cc30', // Logo hellgrün
  ink: '#1f2d11',        // fast schwarz-grün (Logo-Schrift)
  blue: '#35a8e0',
  white: '#ffffff',
  text: '#383838',
  grey: '#e6e6e6',
};

export const FONT = 'Titillium Web';

export const ASSETS = {
  svLogo: 'assets/sv-logo.svg',
  fonts: {
    regular: 'fonts/TitilliumWeb-Regular.ttf',
    semibold: 'fonts/TitilliumWeb-SemiBold.ttf',
    bold: 'fonts/TitilliumWeb-Bold.ttf',
    boldItalic: 'fonts/TitilliumWeb-BoldItalic.ttf',
    black: 'fonts/TitilliumWeb-Black.ttf',
  },
};

/** Sicherstellen, dass Titillium in allen Schnitten geladen ist (wichtig vor Canvas-Zeichnen). */
let fontsReady;
export function ensureFonts() {
  fontsReady ||= Promise.all([
    `400 20px "${FONT}"`, `600 20px "${FONT}"`, `700 20px "${FONT}"`,
    `italic 700 20px "${FONT}"`, `900 20px "${FONT}"`,
  ].map(f => document.fonts.load(f))).then(() => document.fonts.ready);
  return fontsReady;
}

/**
 * Aktuelles Hallencup-Logo (vom Logo-Editor gespeichert).
 * Der Logo-Editor legt die fertige SVG unter diesem Schlüssel in localStorage ab,
 * damit der Content-Generator sie als Overlay nutzen kann.
 */
export const HALLENCUP_LOGO_KEY = 'svl.hallencup.svg';
export function getHallencupLogoSvg() {
  try { return localStorage.getItem(HALLENCUP_LOGO_KEY); } catch { return null; }
}
export function setHallencupLogoSvg(svgString) {
  try { localStorage.setItem(HALLENCUP_LOGO_KEY, svgString); } catch (e) { console.warn(e); }
}

/** SVG-String → Data-URL (für <img> / Canvas). */
export function svgToDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
