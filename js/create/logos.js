// Logos als hochaufgelöste Bilder laden (SVG mit fester Pixelgröße → scharf auf dem Canvas).
import { ASSETS, getHallencupLogoSvg, svgToDataUrl } from '../brand.js';
import { loadImage } from '../util.js';

const CUP_FALLBACK = 'assets/hallencup-vorlagen/Hallencup-2026-reg-02.svg';
const RASTER_PX = 1400; // längste Seite – größer als jedes Logo im Export
const cache = new Map();

/** SVG-String so umschreiben, dass das <img> mit `px` Pixeln gerastert wird. */
function sizedSvgDataUrl(svgText, px) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('Ungültiges SVG');
  let vb = root.getAttribute('viewBox');
  const w0 = parseFloat(root.getAttribute('width')) || 0;
  const h0 = parseFloat(root.getAttribute('height')) || 0;
  if (!vb && w0 && h0) { vb = `0 0 ${w0} ${h0}`; root.setAttribute('viewBox', vb); }
  const parts = (vb || '0 0 100 100').trim().split(/[\s,]+/).map(Number);
  const ratio = parts[2] > 0 && parts[3] > 0 ? parts[2] / parts[3] : 1;
  root.setAttribute('width', String(Math.round(ratio >= 1 ? px : px * ratio)));
  root.setAttribute('height', String(Math.round(ratio >= 1 ? px / ratio : px)));
  return svgToDataUrl(new XMLSerializer().serializeToString(root));
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

/** 'club' | 'cup' → Promise<HTMLImageElement> */
export function loadLogo(key) {
  if (!cache.has(key)) {
    const p = (async () => {
      let svg = key === 'cup' ? getHallencupLogoSvg() : null;
      if (!svg) svg = await fetchText(key === 'club' ? ASSETS.svLogo : CUP_FALLBACK);
      try {
        return await loadImage(sizedSvgDataUrl(svg, RASTER_PX));
      } catch (e) {
        if (key === 'cup' && getHallencupLogoSvg()) { // gespeichertes Logo defekt → Vorlage
          return loadImage(sizedSvgDataUrl(await fetchText(CUP_FALLBACK), RASTER_PX));
        }
        throw e;
      }
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

/** Hallencup-Logo kann sich im Logo-Editor geändert haben → neu laden. */
export function resetLogoCache() { cache.delete('cup'); }

export const logoKeys = choice => ({ club: ['club'], cup: ['cup'], both: ['club', 'cup'], none: [] }[choice] || []);
