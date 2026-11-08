// Zeichnet eine komplette Szene (Bild/Video-Frame + Vorlage + Texte + Logos) in Ausgabe-Koordinaten.
import { COLORS, FONT } from '../brand.js';

const SLANT = Math.tan(14 * Math.PI / 180); // Schräge wie auf sv-liegau.de
const CAP = 0.69;                            // Versalhöhe Titillium (Anteil an Schriftgröße)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const STYLES = [
  { id: 'bar',      label: 'Grüner Balken' },
  { id: 'card',     label: 'Weiße Karte' },
  { id: 'gradient', label: 'Verlauf' },
  { id: 'none',     label: 'Ohne Text' },
];

/** Grundmaßstab: 1 bei 1080 Breite; Querformat wird über die Höhe begrenzt. */
export const scaleOf = (W, H) => Math.min(W / 1080, H / 810);

/** Sicherer Bereich: Stories halten oben 250 px und unten 340 px (bei 1920) frei. */
export function safeArea(W, H, story) {
  const s = scaleOf(W, H);
  const x = Math.round(64 * s);
  if (story) {
    const top = Math.round(H * 250 / 1920), bottom = Math.round(H * 340 / 1920);
    return { s, x, y: top, w: W - 2 * x, h: H - top - bottom };
  }
  const y = Math.round(56 * s);
  return { s, x, y, w: W - 2 * x, h: H - 2 * y };
}

/** Position/Größe des Mediums für Bildausschnitt (frame = {x, y, zoom} in Ausgabe-Pixeln). */
export function frameGeometry(W, H, srcW, srcH, fit, frame = {}) {
  const base = fit === 'blur' ? Math.min(W / srcW, H / srcH) : Math.max(W / srcW, H / srcH);
  const sc = base * (frame.zoom || 1);
  const dw = srcW * sc, dh = srcH * sc;
  const limX = Math.abs(dw - W) / 2, limY = Math.abs(dh - H) / 2;
  const x = clamp(frame.x || 0, -limX, limX), y = clamp(frame.y || 0, -limY, limY);
  return { dx: W / 2 + x - dw / 2, dy: H / 2 + y - dh / 2, dw, dh, x, y };
}

// ---------- Hintergrund ----------
let blurCanvas;
const supportsFilter = (() => {
  try { const c = document.createElement('canvas').getContext('2d'); return typeof c.filter === 'string'; } catch { return false; }
})();

function drawBlurBackground(ctx, W, H, src, srcW, srcH) {
  // Klein rechnen (+ ggf. Filter) und wieder hochskalieren → weicher, günstiger Weichzeichner.
  const div = supportsFilter ? 8 : 28;
  const bw = Math.max(8, Math.round(W / div)), bh = Math.max(8, Math.round(H / div));
  blurCanvas ||= document.createElement('canvas');
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) { blurCanvas.width = bw; blurCanvas.height = bh; }
  const b = blurCanvas.getContext('2d');
  const sc = Math.max(bw / srcW, bh / srcH) * 1.15;
  const dw = srcW * sc, dh = srcH * sc;
  b.filter = supportsFilter ? `blur(${Math.max(2, bw / 60).toFixed(1)}px)` : 'none';
  b.drawImage(src, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
  b.filter = 'none';
  const m = supportsFilter ? W * 0.06 : 0; // Ränder des Filters abschneiden
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurCanvas, -m, -m, W + 2 * m, H + 2 * m);
  ctx.fillStyle = 'rgba(15,22,8,.28)';
  ctx.fillRect(0, 0, W, H);
}

function drawPlaceholder(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.greenDark); g.addColorStop(1, COLORS.green);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.moveTo(W * .55, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * .55 - H * SLANT, H); ctx.closePath(); ctx.fill();
}

// ---------- Text ----------
const fontStr = (weight, size, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size.toFixed(1)}px "${FONT}", Helvetica, Arial, sans-serif`;
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px.toFixed(1)}px`; }

const KIND = {
  eyebrow:  { base: 40,  weight: 700, italic: false, upper: true,  spacing: 0.1,  maxLines: 2 },
  headline: { base: 118, weight: 700, italic: true,  upper: false, spacing: 0,    maxLines: 5 },
  info:     { base: 48,  weight: 600, italic: false, upper: false, spacing: 0.01, maxLines: 4 },
};

function applyFont(ctx, kind, size) {
  const k = KIND[kind];
  ctx.font = fontStr(k.weight, size, k.italic);
  setSpacing(ctx, k.spacing * size);
}

/** Zeilenumbruch nach Wörtern; `overflow` wenn ein Wort allein zu breit ist. */
function wrap(ctx, text, maxW) {
  const lines = []; let overflow = false;
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = words[0];
    for (const w of words.slice(1)) {
      const t = line + ' ' + w;
      if (ctx.measureText(t).width <= maxW) line = t; else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  const out = lines.map(t => { const w = ctx.measureText(t).width; if (w > maxW) overflow = true; return { text: t, w }; });
  return { lines: out, overflow };
}

/**
 * Vorlagen. Jede liefert Zeilenhöhen, horizontalen Platzbedarf, Blockhöhe und Zeichnung.
 * Alle Werte in Ausgabepixeln.
 */
const STYLE_IMPL = {
  bar: {
    align: 'left',
    lineH: (kind, size) => size * (kind === 'headline' ? 1.16 : 1.55),
    extraW: (kind, size) => size * (kind === 'headline' ? 0.64 : 0.9) + size * (kind === 'headline' ? 1.16 : 1.55) * SLANT,
    rowGap: (kind, s) => 12 * s,
    lineGap: (kind, s) => 6 * s,
    pad: () => 0,
    draw(ctx, rows, box, s) {
      let y = box.y;
      const colors = { eyebrow: [COLORS.ink, COLORS.greenLight], headline: [COLORS.green, '#fff'], info: ['#fff', COLORS.ink] };
      rows.forEach((r, ri) => {
        r.lines.forEach((ln, li) => {
          const h = r.lineH, padX = r.size * (r.kind === 'headline' ? 0.32 : 0.45);
          const w = ln.w + 2 * padX, x = box.x, off = h * SLANT;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 24 * s; ctx.shadowOffsetY = 6 * s;
          ctx.fillStyle = colors[r.kind][0];
          ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + off + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
          ctx.restore();
          ctx.fillStyle = colors[r.kind][1];
          applyFont(ctx, r.kind, r.size);
          ctx.fillText(ln.text, x + padX + off / 2, y + h / 2 + r.size * CAP / 2);
          y += h + (li < r.lines.length - 1 ? r.lineGap : 0);
        });
        if (ri < rows.length - 1) y += r.rowGap;
      });
    },
  },

  card: {
    align: 'left',
    lineH: (kind, size) => size * (kind === 'headline' ? 1.06 : kind === 'eyebrow' ? 1.6 : 1.3),
    extraW: (kind, size, s) => kind === 'eyebrow' ? size * 0.9 + size * 1.6 * SLANT + 60 * s : 2 * 44 * s + 14 * s,
    rowGap: (kind, s) => (kind === 'eyebrow' ? 0 : 22 * s),
    lineGap: () => 0,
    pad: s => 2 * 44 * s,
    draw(ctx, rows, box, s) {
      const P = 44 * s, A = 14 * s;
      const eb = rows.find(r => r.kind === 'eyebrow');
      const body = rows.filter(r => r.kind !== 'eyebrow');
      const tabH = eb ? eb.lineH * eb.lines.length : 0;
      const cardY = box.y + tabH / 2;
      const cardH = box.h - tabH / 2;
      // Karte so breit wie der Inhalt (mind. 60 %), nicht immer volle Breite
      const contentW = Math.max(0, ...body.flatMap(r => r.lines.map(l => l.w)), eb ? Math.max(...eb.lines.map(l => l.w)) + eb.size * 1.4 : 0);
      box = { ...box, w: Math.min(box.w, Math.max(box.w * 0.6, contentW + 2 * P + A + 20 * s)) };
      // Karte
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 36 * s; ctx.shadowOffsetY = 10 * s;
      ctx.fillStyle = '#fff';
      roundRect(ctx, box.x, cardY, box.w, cardH, 6 * s); ctx.fill();
      ctx.restore();
      ctx.save(); roundRect(ctx, box.x, cardY, box.w, cardH, 6 * s); ctx.clip();
      ctx.fillStyle = COLORS.green; ctx.fillRect(box.x, cardY, A, cardH);
      // schräger Streifen rechts unten (Website-Motiv)
      ctx.fillStyle = 'rgba(118,204,48,.16)';
      const sx = box.x + box.w - 150 * s;
      ctx.beginPath(); ctx.moveTo(sx, cardY + cardH); ctx.lineTo(sx + cardH * SLANT, cardY); ctx.lineTo(box.x + box.w + 10, cardY); ctx.lineTo(box.x + box.w + 10, cardY + cardH); ctx.closePath(); ctx.fill();
      ctx.restore();
      // Reiter mit kleiner Zeile
      if (eb) {
        let y = box.y;
        eb.lines.forEach(ln => {
          const h = eb.lineH, padX = eb.size * 0.45, off = h * SLANT, x = box.x + A + P - padX - off / 2;
          const w = ln.w + 2 * padX;
          ctx.fillStyle = COLORS.green;
          ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + off + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff'; applyFont(ctx, 'eyebrow', eb.size);
          ctx.fillText(ln.text, x + padX + off / 2, y + h / 2 + eb.size * CAP / 2);
          y += h;
        });
      }
      let y = cardY + P + (eb ? tabH / 2 * 0.55 : 0);
      body.forEach((r, ri) => {
        applyFont(ctx, r.kind, r.size);
        ctx.fillStyle = r.kind === 'headline' ? COLORS.green : COLORS.text;
        r.lines.forEach(ln => { ctx.fillText(ln.text, box.x + A + P, y + r.lineH / 2 + r.size * CAP / 2); y += r.lineH; });
        if (ri < body.length - 1) y += r.rowGap;
      });
    },
    // Blockhöhe: Reiter ragt halb über die Karte
    height(rows, s) {
      const eb = rows.find(r => r.kind === 'eyebrow');
      const body = rows.filter(r => r.kind !== 'eyebrow');
      const tabH = eb ? eb.lineH * eb.lines.length : 0;
      let h = 2 * 44 * s + (eb ? tabH / 2 * 0.55 : 0);
      body.forEach((r, i) => { h += r.lineH * r.lines.length + (i < body.length - 1 ? r.rowGap : 0); });
      return h + tabH / 2;
    },
  },

  gradient: {
    align: 'center',
    lineH: (kind, size) => size * (kind === 'headline' ? 1.06 : 1.3),
    extraW: () => 0,
    rowGap: (kind, s) => (kind === 'eyebrow' ? 14 * s : 24 * s),
    lineGap: () => 0,
    pad: () => 0,
    topExtra: s => 30 * s, // Akzentstrich über der kleinen Zeile
    background(ctx, W, H, box, pos) {
      let g;
      if (pos === 'bottom') {
        const y0 = Math.max(0, box.y - H * 0.22);
        g = ctx.createLinearGradient(0, y0, 0, H);
        g.addColorStop(0, 'rgba(18,27,10,0)'); g.addColorStop(0.45, 'rgba(18,27,10,.62)'); g.addColorStop(1, 'rgba(18,27,10,.9)');
        ctx.fillStyle = g; ctx.fillRect(0, y0, W, H - y0);
      } else if (pos === 'top') {
        const y1 = Math.min(H, box.y + box.h + H * 0.22);
        g = ctx.createLinearGradient(0, 0, 0, y1);
        g.addColorStop(0, 'rgba(18,27,10,.9)'); g.addColorStop(0.55, 'rgba(18,27,10,.62)'); g.addColorStop(1, 'rgba(18,27,10,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, y1);
      } else {
        const y0 = Math.max(0, box.y - H * 0.18), y1 = Math.min(H, box.y + box.h + H * 0.18);
        g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, 'rgba(18,27,10,0)'); g.addColorStop(0.3, 'rgba(18,27,10,.7)'); g.addColorStop(0.7, 'rgba(18,27,10,.7)'); g.addColorStop(1, 'rgba(18,27,10,0)');
        ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
      }
    },
    draw(ctx, rows, box, s) {
      const cx = box.x + box.w / 2;
      let y = box.y;
      // Akzent: schräger grüner Strich
      const aw = 110 * s, ah = 12 * s;
      ctx.fillStyle = COLORS.greenLight;
      ctx.beginPath(); ctx.moveTo(cx - aw / 2 + ah * SLANT, y); ctx.lineTo(cx + aw / 2 + ah * SLANT, y); ctx.lineTo(cx + aw / 2, y + ah); ctx.lineTo(cx - aw / 2, y + ah); ctx.closePath(); ctx.fill();
      y += 30 * s;
      ctx.textAlign = 'center';
      rows.forEach((r, ri) => {
        applyFont(ctx, r.kind, r.size);
        ctx.fillStyle = r.kind === 'eyebrow' ? COLORS.greenLight : r.kind === 'info' ? 'rgba(255,255,255,.93)' : '#fff';
        ctx.save();
        if (r.kind === 'headline') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 3 * s; }
        r.lines.forEach(ln => { ctx.fillText(ln.text, cx, y + r.lineH / 2 + r.size * CAP / 2); y += r.lineH; });
        ctx.restore();
        if (ri < rows.length - 1) y += r.rowGap;
      });
      ctx.textAlign = 'left';
    },
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function genericHeight(st, rows, s) {
  if (st.height) return st.height(rows, s);
  let h = st.topExtra ? st.topExtra(s) : 0;
  rows.forEach((r, i) => {
    h += r.lineH * r.lines.length + r.lineGap * (r.lines.length - 1) + (i < rows.length - 1 ? r.rowGap : 0);
  });
  return h + st.pad(s);
}

/** Texte so umbrechen und verkleinern, dass sie in maxW × maxH passen. */
export function layoutText(ctx, styleId, texts, maxW, maxH, s) {
  const st = STYLE_IMPL[styleId];
  if (!st) return null;
  const items = ['eyebrow', 'headline', 'info']
    .map(kind => ({ kind, text: (texts[kind] || '').trim() }))
    .filter(i => i.text);
  if (!items.length) return null;
  let rows = null, height = 0;
  for (let f = 1; f >= 0.24; f -= 0.03) {
    let ok = true;
    rows = items.map(({ kind, text }) => {
      const k = KIND[kind];
      // kleine Zeilen schrumpfen weniger stark als die Überschrift
      const size = k.base * s * (kind === 'headline' ? f : Math.min(1, 0.35 + f * 0.75));
      applyFont(ctx, kind, size);
      const t = k.upper ? text.toLocaleUpperCase('de-DE') : text;
      const { lines, overflow } = wrap(ctx, t, maxW - st.extraW(kind, size, s));
      if (overflow || lines.length > k.maxLines) ok = false;
      return { kind, size, lines, lineH: st.lineH(kind, size), rowGap: st.rowGap(kind, s), lineGap: st.lineGap(kind, s) };
    });
    height = genericHeight(st, rows, s);
    if (ok && height <= maxH) break;
  }
  setSpacing(ctx, 0);
  return { rows, height, st };
}

/**
 * Szene zeichnen. ctx muss so transformiert sein, dass 1 Einheit = 1 Ausgabepixel.
 * scene: { W, H, story, src, srcW, srcH, fit, frame, style, texts, textPos, logos:[img], logoPos, logoSize }
 */
export function drawScene(ctx, sc) {
  const { W, H } = sc;
  ctx.save();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, W, H);

  // Medium
  if (sc.src && sc.srcW && sc.srcH) {
    if (sc.fit === 'blur') drawBlurBackground(ctx, W, H, sc.src, sc.srcW, sc.srcH);
    const g = frameGeometry(W, H, sc.srcW, sc.srcH, sc.fit, sc.frame);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (sc.fit === 'blur') { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 40 * scaleOf(W, H); }
    ctx.drawImage(sc.src, g.dx, g.dy, g.dw, g.dh);
    if (sc.fit === 'blur') ctx.restore();
  } else {
    drawPlaceholder(ctx, W, H);
  }

  const area = safeArea(W, H, sc.story);
  const s = area.s;

  // Logos (Maße zuerst, damit der Text ausweichen kann)
  const L = (sc.logoSize || 0.2) * Math.min(W, H);
  const logos = (sc.logos || []).filter(img => img && img.naturalWidth);
  const gap = 0.05 * Math.min(W, H);
  const pos = sc.logoPos || 'tr';
  let logoBoxes = [];
  if (logos.length) {
    const items = logos.map(img => ({ img, h: L, w: L * img.naturalWidth / img.naturalHeight }));
    const totalW = items.reduce((a, i) => a + i.w, 0) + gap * 0.5 * (items.length - 1);
    let x = pos[1] === 'l' ? area.x : area.x + area.w - totalW;
    const y = pos[0] === 't' ? area.y : area.y + area.h - L;
    logoBoxes = items.map(i => { const b = { ...i, x, y }; x += i.w + gap * 0.5; return b; });
  }

  // Text
  const style = sc.style || 'bar';
  if (style !== 'none') {
    const t = { ...area };
    const tp = sc.textPos || 'bottom';
    if (logoBoxes.length && tp === 'top' && pos[0] === 't') { t.y += L + gap; t.h -= L + gap; }
    if (logoBoxes.length && tp === 'bottom' && pos[0] === 'b') { t.h -= L + gap; }
    const maxH = t.h * (tp === 'middle' ? 0.9 : 0.8);
    const lay = layoutText(ctx, style, sc.texts || {}, t.w, maxH, s);
    if (lay) {
      const y = tp === 'top' ? t.y : tp === 'middle' ? t.y + (t.h - lay.height) / 2 : t.y + t.h - lay.height;
      const box = { x: t.x, y, w: t.w, h: lay.height };
      lay.st.background?.(ctx, W, H, box, tp);
      lay.st.draw(ctx, lay.rows, box, s);
      setSpacing(ctx, 0);
    }
  }

  // Logos zeichnen
  for (const b of logoBoxes) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 20 * s; ctx.shadowOffsetY = 4 * s;
    ctx.drawImage(b.img, b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  ctx.restore();
}
