// Hallencup-Logo-Generator.
//
// Erzeugt aus den Illustrator-Vorlagen (assets/hallencup-vorlagen) ein neues Logo als SVG-String.
// Alle statischen Teile (Wappen, Badge, Banner, Schleife) werden 1:1 übernommen (js/logo/art-*.js),
// die veränderlichen Texte werden mit opentype.js als Pfade erzeugt – die fertige SVG braucht
// also keine Schrift, genau wie das Original.
//
//   const res = await loadLogoResources({ variant: 'gruen' });
//   const svg = buildHallencupSvg({ edition: 26, dateText: '15.–17.01.2027' }, res);
//
// Maße/Positionen sind aus den Vorlagen ausgemessen (Titillium Web Bold 58 pt, Laufweite −40
// im Banner; SemiBold 39 pt entlang der Kurve für das Datum; Bold 29 pt Zusatzzeile).

import GRUEN from './logo/art-gruen.js';

export const DEFAULTS = Object.freeze({
  edition: 25,
  title: 'HALLENCUP',
  subtitle: '',
  dateText: '16.–18.01.2026',
  stars: true,
  variant: 'gruen', // 'gruen' | 'silber'
});

const MODULE_URL = import.meta.url;
const url = rel => new URL(rel, MODULE_URL).href;

/* ------------------------------------------------------------------ Laden */

let opentypePromise;
/** opentype.js (UMD) per <script> laden → window.opentype. */
export function loadOpentype() {
  if (globalThis.opentype?.parse) return Promise.resolve(globalThis.opentype);
  opentypePromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url('../vendor/opentype.min.js');
    s.async = true;
    s.onload = () => (globalThis.opentype?.parse ? resolve(globalThis.opentype) : reject(new Error('opentype.js nicht verfügbar')));
    s.onerror = () => reject(new Error('opentype.js konnte nicht geladen werden'));
    document.head.append(s);
  }).catch(e => { opentypePromise = null; throw e; });
  return opentypePromise;
}

const fontCache = {};
async function loadFont(file) {
  fontCache[file] ||= (async () => {
    const ot = await loadOpentype();
    const r = await fetch(url(`../fonts/${file}`));
    if (!r.ok) throw new Error(`Schrift ${file} fehlt (${r.status})`);
    return ot.parse(await r.arrayBuffer());
  })().catch(e => { delete fontCache[file]; throw e; });
  return fontCache[file];
}

let silberPromise;
function loadSilberArt() {
  silberPromise ||= import('./logo/art-silber.js').then(m => m.default)
    .catch(e => { silberPromise = null; throw e; });
  return silberPromise;
}

/**
 * Schriften (und bei Bedarf die Silber-Grafik) laden.
 * Rückgabe: { fonts: { bold, semibold }, silber?: object }
 */
export async function loadLogoResources({ variant = 'gruen' } = {}) {
  const [bold, semibold, silber] = await Promise.all([
    loadFont('TitilliumWeb-Bold.ttf'),
    loadFont('TitilliumWeb-SemiBold.ttf'),
    variant === 'silber' ? loadSilberArt() : null,
  ]);
  return { fonts: { bold, semibold }, ...(silber ? { silber } : {}) };
}

/* ------------------------------------------------------------- Datum */

const pad = n => String(n).padStart(2, '0');

/**
 * Turnierdatum im Stil des Originals:
 *   gleicher Monat:  16.–18.01.2026
 *   anderer Monat:   30.01.–01.02.2026
 *   anderes Jahr:    30.12.2026 – 02.01.2027
 *   ein Tag:         16.01.2026
 * Parameter: 'YYYY-MM-DD' oder Date.
 */
export function formatDateRange(from, to) {
  const parse = v => {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  };
  let a = parse(from), b = parse(to);
  if (!a && !b) return '';
  if (!a || !b) { const x = a || b; return `${pad(x.d)}.${pad(x.m)}.${x.y}`; }
  if (b.y * 10000 + b.m * 100 + b.d < a.y * 10000 + a.m * 100 + a.d) [a, b] = [b, a];
  const full = x => `${pad(x.d)}.${pad(x.m)}.${x.y}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return full(a);
  if (a.y === b.y && a.m === b.m) return `${pad(a.d)}.–${full(b)}`;
  if (a.y === b.y) return `${pad(a.d)}.${pad(a.m)}.–${full(b)}`;
  return `${full(a)} – ${full(b)}`;
}

/* ------------------------------------------------------- Text → Pfad */

const r2 = n => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
};

/** Glyphen einer Zeile mit Kerning und Laufweite (tracking in 1/1000 em) anordnen. */
function layoutLine(font, text, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const items = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    const adv = g.advanceWidth * scale;
    items.push({ glyph: g, x, adv });
    x += adv;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking / 1000 * size;
  });
  // Sichtbare Breite: von linker Kante des ersten bis rechter Kante des letzten Zeichens (ohne Laufweite am Ende)
  let x1 = Infinity, x2 = -Infinity;
  for (const it of items) {
    const bb = it.glyph.getBoundingBox();
    if (bb.x1 === bb.x2) continue; // Leerzeichen
    x1 = Math.min(x1, it.x + bb.x1 * scale);
    x2 = Math.max(x2, it.x + bb.x2 * scale);
  }
  if (x1 === Infinity) { x1 = 0; x2 = 0; }
  return { items, advance: x, x1, x2, width: x2 - x1, size, scale };
}

/** Path-Kommandos mit Punkt-Transformation in SVG-Pfaddaten umwandeln. */
function commandsToD(commands, tf) {
  let d = '';
  for (const c of commands) {
    if (c.type === 'Z') { d += 'Z'; continue; }
    const pts = [];
    if (c.type === 'Q') pts.push([c.x1, c.y1]);
    if (c.type === 'C') pts.push([c.x1, c.y1], [c.x2, c.y2]);
    pts.push([c.x, c.y]);
    d += c.type + pts.map(([x, y]) => { const [X, Y] = tf(x, y); return `${r2(X)},${r2(Y)}`; }).join(' ');
  }
  return d;
}

/** Zeile so einpassen: Schriftgröße verkleinern, bis sie in maxWidth passt. */
function fitLine(font, text, size, tracking, maxWidth) {
  let line = layoutLine(font, text, size, tracking);
  if (line.width > maxWidth && line.width > 0) line = layoutLine(font, text, size * maxWidth / line.width, tracking);
  return line;
}

/** Gerade Textzeile, horizontal um cx zentriert (sichtbare Breite), Grundlinie baseline. */
function straightText(line, cx, baseline) {
  const ox = cx - (line.x1 + line.x2) / 2;
  let d = '';
  for (const it of line.items) {
    const p = it.glyph.getPath(0, 0, line.size);
    d += commandsToD(p.commands, (x, y) => [ox + it.x + x, baseline + y]);
  }
  return d;
}

/** Kubische Bézierkurve mit Bogenlängen-Tabelle. */
function makeCurve([p0, p1, p2, p3]) {
  const pt = t => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  const der = t => {
    const u = 1 - t;
    return [
      3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
      3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
    ];
  };
  const N = 600, ts = [0], ls = [0];
  let prev = pt(0), len = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, p = pt(t);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    ts.push(t); ls.push(len); prev = p;
  }
  const tAt = s => {
    if (s <= 0) return 0;
    if (s >= len) return 1;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ls[mid] < s) lo = mid; else hi = mid; }
    return ts[lo] + (ts[hi] - ts[lo]) * (s - ls[lo]) / (ls[hi] - ls[lo]);
  };
  /** Bogenlänge an der Stelle, wo die Kurve x erreicht. */
  const sAtX = x => {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) { const dx = Math.abs(pt(ts[i])[0] - x); if (dx < bd) { bd = dx; best = i; } }
    return ls[best];
  };
  return { length: len, sAtX, at: s => { const t = tAt(s); const [dx, dy] = der(t); return { p: pt(t), a: Math.atan2(dy, dx) }; } };
}

/** Text entlang einer Kurve: Zeichen auf Tangente gedreht, Mitte bei Bogenlänge sCenter. */
function curvedText(line, curve, sCenter, baselineOffset) {
  const start = sCenter - (line.x1 + line.x2) / 2;
  let d = '';
  for (const it of line.items) {
    const bb = it.glyph.getBoundingBox();
    if (bb.x1 === bb.x2) continue;
    const s = start + it.x + it.adv / 2;
    const { p, a } = curve.at(s);
    const cos = Math.cos(a), sin = Math.sin(a);
    // Grundlinienpunkt (auf der Normalen verschoben)
    const bx = p[0] - sin * baselineOffset, by = p[1] + cos * baselineOffset;
    const path = it.glyph.getPath(-it.adv / 2, 0, line.size);
    d += commandsToD(path.commands, (x, y) => [bx + x * cos - y * sin, by + x * sin + y * cos]);
  }
  return d;
}

/** 8-zackiger Stern wie in der Vorlage. */
function star(cx, cy, r, fill) {
  const i = r * 0.3536;
  const pts = [[0, -r], [i, -i], [r, 0], [i, i], [0, r], [-i, i], [-r, 0], [-i, -i]]
    .map(([x, y]) => `${r2(cx + x)} ${r2(cy + y)}`).join(' ');
  return `<polygon points="${pts}" style="fill: ${fill};"/>`;
}

/* --------------------------------------------------------- Layouts */

// Alle Werte in Koordinaten der jeweiligen Vorlage.
const CURVE = [[110.38, 524.88], [245.38, 539.88], [327.38, 539.88], [472.38, 528.88]];
const shiftCurve = (dx, dy) => CURVE.map(([x, y]) => [x + dx, y + dy]);

const LAYOUT = {
  gruen: {
    color: '#33691e',
    banner: { cx: 294.05, capMid: 409.42, maxWidth: 396, fill: '#fff' },
    date: { centerX: 299.13, maxWidth: 282, fill: '#33691e' },
    short: { box: [65.5, 35.25, 451.77, 523.5], ribbonDy: 0 },
    tall: { box: [65.5, 35.25, 451.77, 544.5], ribbonDy: 21 },
  },
  silber: {
    dx: -52.27, // Versatz Silber-Vorlage gegenüber Grün (Wappen-Mitte)
    banner: { cx: 241.78, capMid: 398.39, maxWidth: 386, fill: '#fff' },
    date: { centerX: 246.86, maxWidth: 282, fill: '#5d5e61' },
    sub: { cx: 243.68, baseline: 476.58, fill: '#5d5e61', starFill: '#989498' },
    box: [19, 20, 451.87, 544.64],
  },
};

const TYPE = {
  banner: { size: 58, tracking: -40 },
  date: { size: 39, tracking: -2, baselineOffset: 0 },
  subGruen: { size: 29, tracking: 0 },
  subSilber: { size: 34, tracking: 110 },
};

/** Optionen normalisieren (leere Felder → sinnvolle Werte). */
export function normalizeOptions(o = {}) {
  const opt = { ...DEFAULTS, ...o };
  opt.variant = opt.variant === 'silber' ? 'silber' : 'gruen';
  opt.title = String(opt.title ?? '').trim();
  opt.subtitle = String(opt.subtitle ?? '').trim();
  opt.dateText = String(opt.dateText ?? '').trim();
  const ed = String(opt.edition ?? '').trim();
  opt.edition = ed;
  opt.stars = !!opt.stars;
  return opt;
}

export function bannerText(o) {
  const title = (o.title || '').toLocaleUpperCase('de-DE');
  return [o.edition ? `${o.edition}.` : '', title].filter(Boolean).join(' ');
}

/**
 * Logo als SVG-String erzeugen.
 * @param {object} options  { edition, title, subtitle, dateText, stars, variant }
 * @param {object} res      Ergebnis von loadLogoResources() – { fonts: { bold, semibold }, silber? }
 */
export function buildHallencupSvg(options, res) {
  const o = normalizeOptions(options);
  const { bold, semibold } = res.fonts;
  if (o.variant === 'silber' && !res.silber) throw new Error('Silber-Grafik nicht geladen');
  return o.variant === 'silber' ? buildSilber(o, bold, semibold, res.silber) : buildGruen(o, bold, semibold);
}

function bannerPath(o, bold, L) {
  const text = bannerText(o);
  if (!text) return '';
  const line = fitLine(bold, text, TYPE.banner.size, TYPE.banner.tracking, L.maxWidth);
  const cap = (bold.tables.os2?.sCapHeight || 680) / bold.unitsPerEm * line.size;
  return `<path d="${straightText(line, L.cx, L.capMid + cap / 2)}" style="fill: ${L.fill};"/>`;
}

function datePath(o, semibold, L, curvePts) {
  if (!o.dateText) return '';
  const curve = makeCurve(curvePts);
  const line = fitLine(semibold, o.dateText, TYPE.date.size, TYPE.date.tracking, L.maxWidth);
  // Bei verkleinerter Schrift die Zeichen etwas nach unten (Mitte der Schleife) rücken
  const shrink = TYPE.date.size - line.size;
  const d = curvedText(line, curve, curve.sAtX(L.centerX), TYPE.date.baselineOffset - shrink * 0.34);
  return `<path d="${d}" style="fill: ${L.fill};"/>`;
}

function svgOpen(box, extra = '') {
  const [x, y, w, h] = box.map(r2);
  return `<svg xmlns="http://www.w3.org/2000/svg"${extra} viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`;
}

function titleTag(o) {
  const t = [bannerText(o), o.subtitle, o.dateText].filter(Boolean).join(' · ');
  return `<title>${t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</title>`;
}

/**
 * Logo in einzelne Ebenen zerlegt (für Animationen).
 * Jede Ebene ist eine vollständige SVG mit derselben viewBox wie das Logo.
 * Reihenfolge = Zeichenreihenfolge.
 * @returns {{ box: number[], layers: { id: string, svg: string }[] }}
 */
export function buildHallencupLayers(options, res) {
  const o = normalizeOptions(options);
  const { bold, semibold } = res.fonts;
  if (o.variant === 'silber' && !res.silber) throw new Error('Silber-Grafik nicht geladen');
  const { box, open, head, parts } = o.variant === 'silber'
    ? silberParts(o, bold, semibold, res.silber)
    : gruenParts(o, bold, semibold);
  const layers = [];
  for (const { id, markup } of parts) {
    if (!markup) continue;
    const prev = layers[layers.length - 1];
    if (prev && prev.id === id) prev.markup += markup; // gleiche Ebene zusammenfassen
    else layers.push({ id, markup });
  }
  return { box, layers: layers.map(l => ({ id: l.id, svg: `${open}${head}${l.markup}</svg>` })) };
}

function joinParts({ open, head, parts }, o) {
  return [open, titleTag(o), head, ...parts.map(p => p.markup), '</svg>'].join('');
}

function buildGruen(o, bold, semibold) {
  return joinParts(gruenParts(o, bold, semibold), o);
}

function buildSilber(o, bold, semibold, S) {
  return joinParts(silberParts(o, bold, semibold, S), o);
}

function gruenParts(o, bold, semibold) {
  const L = LAYOUT.gruen;
  const tall = !!o.subtitle;
  const V = tall ? L.tall : L.short;
  const parts = [
    { id: 'badge', markup: GRUEN.ring },
    { id: 'badge', markup: tall ? GRUEN.badgeTall : GRUEN.badgeShort },
    { id: 'emblem', markup: GRUEN.emblem },
  ];

  // Schleife + Datum
  const ribbon = V.ribbonDy ? `<g transform="translate(0 ${V.ribbonDy})">${GRUEN.ribbon}</g>` : GRUEN.ribbon;
  parts.push({ id: 'ribbon', markup: ribbon }, { id: 'date', markup: datePath(o, semibold, L.date, shiftCurve(0, V.ribbonDy)) });

  // Banner
  parts.push({ id: 'banner', markup: GRUEN.bannerShadow + GRUEN.banner }, { id: 'bannerText', markup: bannerPath(o, bold, L.banner) });

  // Zusatzzeile + Sterne
  if (tall) {
    const line = fitLine(bold, o.subtitle, TYPE.subGruen.size, TYPE.subGruen.tracking, 290);
    // Ohne Sterne: Zeile mittig zwischen Banner und Schleife
    const baseline = o.stars ? 477.2 : 489.5;
    parts.push({ id: 'subtitle', markup: `<path d="${straightText(line, 296.59, baseline)}" style="fill: ${L.color};"/>` });
    if (o.stars) [-30.13, 0, 30.13].forEach((dx, i) => parts.push({ id: `star${i}`, markup: star(296.88 + dx, 496.74, 9.14, L.color) }));
  } else if (o.stars) {
    [-41.2, 0, 41.2].forEach((dx, i) => parts.push({ id: `star${i}`, markup: star(300.88 + dx, 469.38, 12.5, L.color) }));
  }
  return { box: V.box, open: svgOpen(V.box), head: '', parts };
}

function silberParts(o, bold, semibold, S) {
  const L = LAYOUT.silber;
  const parts = [
    { id: 'badge', markup: S.ring + S.badge + S.badgeBevel },
    { id: 'emblem', markup: S.emblem },
    { id: 'ribbon', markup: S.ribbon },
    { id: 'date', markup: datePath(o, semibold, L.date, shiftCurve(L.dx, 5.82)) },
    { id: 'banner', markup: S.bannerShadow + S.banner },
    { id: 'bannerText', markup: bannerPath(o, bold, L.banner) },
  ];

  const sub = L.sub;
  if (o.subtitle) {
    const text = o.subtitle.toLocaleUpperCase('de-DE');
    const line = fitLine(bold, text, TYPE.subSilber.size, TYPE.subSilber.tracking, o.stars ? 200 : 300);
    // Bei kleinerer Schrift Grundlinie so verschieben, dass die Versalhöhe mittig bleibt
    const capMid = sub.baseline - 0.68 * TYPE.subSilber.size / 2;
    const baseline = capMid + 0.68 * line.size / 2;
    parts.push({ id: 'subtitle', markup: `<path d="${straightText(line, sub.cx, baseline)}" style="fill: ${sub.fill};"/>` });
    if (o.stars) {
      const half = line.width / 2, gap = 16.5, r = 9.14, step = 24.03;
      const xs = [half + gap + r + step, half + gap + r];
      // von außen links nach außen rechts
      [-xs[0], -xs[1], xs[1], xs[0]].forEach((dx, i) => parts.push({ id: `star${i}`, markup: star(sub.cx + dx, capMid, r, sub.starFill) }));
    }
  } else if (o.stars) {
    [-41.2, 0, 41.2].forEach((dx, i) => parts.push({ id: `star${i}`, markup: star(sub.cx + dx, 464.5, 12.5, sub.starFill) }));
  }
  return { box: L.box, open: svgOpen(L.box, ' xmlns:xlink="http://www.w3.org/1999/xlink"'), head: S.defs, parts };
}
