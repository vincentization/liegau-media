// Zeichnet Ergebnis-Beiträge auf ein Canvas (Ausgabe-Pixel).
// Layouts: 'paper' (Klassik), 'board' (Anzeigetafel), 'tiles' (Kacheln), 'highlight' (einzelnes Spiel).
import { COLORS, FONT } from '../brand.js';
import { scoreText, outcome, OUTCOME_LABEL, sides, teamLabel, shortDate, weekday, parseIso } from './data.js';

export const LAYOUTS = [
  { id: 'paper', label: 'Klassik', hint: 'Weißes Blatt auf Grün' },
  { id: 'board', label: 'Anzeigetafel', hint: 'Dunkel, Zeilen' },
  { id: 'tiles', label: 'Kacheln', hint: 'Aus Vereinssicht' },
];

export const RESULT_FORMATS = [
  { id: 'post', label: 'Beitrag 4:5', w: 1080, h: 1350, story: false, formatId: 'ig-post', formatLabel: 'Instagram Beitrag (1080×1350)' },
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920, story: true, formatId: 'ig-story', formatLabel: 'Story / WhatsApp Status (1080×1920)' },
  { id: 'square', label: 'Quadrat 1:1', w: 1080, h: 1080, story: false, formatId: 'ig-square', formatLabel: 'Instagram Quadrat (1080×1080)' },
];

const SLANT = Math.tan(14 * Math.PI / 180);
const CAP = 0.69;
const INK = COLORS.ink;
const LOSS = '#5a5a5a';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Text-Helfer ----------
const font = (w, size, italic = false) => `${italic ? 'italic ' : ''}${w} ${size.toFixed(1)}px "${FONT}", Helvetica, Arial, sans-serif`;
function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${(px || 0).toFixed(1)}px`; }
function setFont(ctx, w, size, { italic = false, track = 0 } = {}) { ctx.font = font(w, size, italic); spacing(ctx, track * size); }

/** Text auf maxW kürzen (…). */
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** Schriftgröße so wählen, dass Text in maxW passt. */
function fitSize(ctx, text, w, size, maxW, opts = {}, min = size * 0.5) {
  setFont(ctx, w, size, opts);
  const tw = ctx.measureText(text).width;
  const s = tw > maxW ? Math.max(min, size * maxW / tw) : size;
  setFont(ctx, w, s, opts);
  return s;
}

/** Text horizontal gestaucht zeichnen (wirkt wie eine Condensed-Schrift). Gibt Breite zurück. */
function condensed(ctx, text, x, y, sx, align = 'left') {
  const w = ctx.measureText(text).width * sx;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save(); ctx.translate(x0, y); ctx.scale(sx, 1); ctx.textAlign = 'left'; ctx.fillText(text, 0, 0); ctx.restore();
  return w;
}

function wrapLines(ctx, text, maxW, maxLines = 99) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (!line || ctx.measureText(t).width <= maxW) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = ellipsize(ctx, keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '), maxW);
    return keep;
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Parallelogramm im Website-Stil (oben nach rechts versetzt). */
function slantRect(ctx, x, y, w, h) {
  const o = h * SLANT;
  ctx.beginPath(); ctx.moveTo(x + o, y); ctx.lineTo(x + w + o, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
}

/** Deterministischer Zufall (Körnung/Pinsel sehen in Vorschau und Export gleich aus). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- Logos ----------
function initials(name) {
  const words = String(name || '?').replace(/[^A-Za-zÄÖÜäöüß0-9 ]/g, ' ').split(/\s+/).filter(w => w && !/^(SV|FV|SG|SpG|TSV|FSV|JFV|DJK|BC|SC|FC|e|V|\d+)$/i.test(w));
  return (words.slice(0, 2).map(w => w[0]).join('') || String(name || '?')[0] || '?').toUpperCase();
}

/** Logo zentriert in ein Quadrat (size) zeichnen; ohne Bild → Kreis mit Initialen. */
function drawTeamLogo(ctx, scene, team, cx, cy, size, { ring = false } = {}) {
  const img = team.own ? scene.images.club : scene.images.logos?.get(team.logo);
  if (ring) {
    ctx.save(); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.03;
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (img && img.naturalWidth) {
    const r = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * r, h = img.naturalHeight * r;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  ctx.save();
  ctx.fillStyle = '#d9dcd5';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b6253'; ctx.textAlign = 'center';
  setFont(ctx, 700, size * 0.4);
  ctx.fillText(initials(team.name), cx, cy + size * 0.4 * CAP / 2);
  ctx.restore();
}

function drawClubLogo(ctx, scene, cx, cy, size, shadow = true) {
  const img = scene.images.club;
  if (!img) return;
  ctx.save();
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = size * 0.08; ctx.shadowOffsetY = size * 0.02; }
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

// ---------- Rahmen ----------
/** Inhaltsbereich: Stories halten oben/unten Platz für Instagram-Bedienelemente frei. */
function frame(W, H, story) {
  const s = W / 1080;
  if (story) return { s, top: Math.round(H * 230 / 1920), bottom: H - Math.round(H * 300 / 1920) };
  return { s, top: 0, bottom: H };
}

/** Raster für n Einträge: Spalten, Zeilen, Zeilenhöhe. */
function grid(n, cols, availH, gap, maxRowH) {
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows, rowH: Math.min(maxRowH, (availH - gap * (rows - 1)) / rows) };
}

// =====================================================================
// Layout „Klassik“: weißes Blatt auf grün-grauem Pinsel-Hintergrund
// =====================================================================
function paperBackground(ctx, W, H, s) {
  ctx.fillStyle = COLORS.green; ctx.fillRect(0, 0, W, H);
  const r = rng(7);
  const strokes = [
    [[-0.1, 0.02], [0.65, -0.05], 0.13],
    [[0.75, 0.30], [1.15, 0.12], 0.18],
    [[-0.15, 0.78], [0.45, 1.05], 0.16],
    [[0.70, 0.95], [1.1, 0.70], 0.10],
  ];
  ctx.fillStyle = '#4a4d48';
  for (const [[x1, y1], [x2, y2], th] of strokes) {
    const ax = x1 * W, ay = y1 * H, bx = x2 * W, by = y2 * H;
    const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len, t = th * W;
    ctx.beginPath();
    const N = 26;
    for (let i = 0; i <= N; i++) { const f = i / N, j = (r() - 0.5) * t * 0.12; ctx.lineTo(ax + (bx - ax) * f + nx * (t / 2 + j), ay + (by - ay) * f + ny * (t / 2 + j)); }
    for (let i = N; i >= 0; i--) { const f = i / N, j = (r() - 0.5) * t * 0.12; ctx.lineTo(ax + (bx - ax) * f - nx * (t / 2 + j), ay + (by - ay) * f - ny * (t / 2 + j)); }
    ctx.closePath(); ctx.fill();
  }
  // Körnung / Spritzer
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H, rad = (r() ** 3) * 4.5 * s + 0.6 * s;
    ctx.fillStyle = r() < 0.6 ? 'rgba(255,255,255,.75)' : 'rgba(40,44,38,.6)';
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHash(ctx, x, y, size) {
  // gesprühtes „#“ in Anthrazit
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.12);
  ctx.strokeStyle = '#3d403b'; ctx.lineCap = 'round'; ctx.lineWidth = size * 0.17;
  const a = size * 0.5;
  ctx.beginPath();
  ctx.moveTo(-a * 0.25, -a); ctx.lineTo(-a * 0.42, a);
  ctx.moveTo(a * 0.35, -a); ctx.lineTo(a * 0.18, a);
  ctx.moveTo(-a * 0.95, -a * 0.3); ctx.lineTo(a * 0.9, -a * 0.42);
  ctx.moveTo(-a * 1.0, a * 0.42); ctx.lineTo(a * 0.85, a * 0.3);
  ctx.stroke();
  const r = rng(3);
  ctx.fillStyle = '#3d403b';
  for (let i = 0; i < 40; i++) {
    const ang = r() * Math.PI * 2, d = a * (0.85 + r() * 0.55);
    ctx.beginPath(); ctx.arc(Math.cos(ang) * d, Math.sin(ang) * d, size * 0.006 * (1 + r() * 1.5), 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 4; i++) { // Laufnasen
    const x0 = (r() - 0.5) * a * 1.4, y0 = a * (0.2 + r() * 0.3);
    ctx.fillRect(x0, y0, size * 0.025, a * (0.3 + r() * 0.5));
  }
  ctx.restore();
}

function drawStamp(ctx, text, x, y, w, s) {
  if (!text) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.035);
  setFont(ctx, 900, 30 * s, { track: 0.02 });
  const lines = wrapLines(ctx, text.toUpperCase(), w - 40 * s, 2);
  const lh = 32 * s, h = lines.length * lh + 26 * s;
  const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 44 * s;
  ctx.strokeStyle = COLORS.green; ctx.lineWidth = 4 * s;
  roundRect(ctx, 0, -h, bw, h, 8 * s); ctx.stroke();
  ctx.lineWidth = 2 * s;
  roundRect(ctx, 6 * s, -h + 6 * s, bw - 12 * s, h - 12 * s, 5 * s); ctx.stroke();
  ctx.fillStyle = COLORS.green; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, bw / 2, -h + 13 * s + lh * (i + 0.5) + 30 * s * CAP / 2));
  ctx.restore();
}

function drawPaperCard(ctx, scene, m, x, y, w, h, u, hl) {
  const s = scene.s;
  const pad = 10 * u;
  // Untere Leiste wie im Original, Highlight = grüne Karte
  if (hl) {
    ctx.save(); ctx.shadowColor = 'rgba(30,60,0,.3)'; ctx.shadowBlur = 14 * s; ctx.shadowOffsetY = 4 * s;
    ctx.fillStyle = COLORS.green; roundRect(ctx, x - 6 * u, y - 4 * u, w + 12 * u, h + 4 * u, 6 * u); ctx.fill(); ctx.restore();
    ctx.fillStyle = COLORS.greenLight; ctx.fillRect(x - 6 * u, y + h - 8 * u, w + 12 * u, 8 * u);
  } else {
    ctx.fillStyle = '#e4e4e4'; ctx.fillRect(x, y + h - 8 * u, w, 8 * u);
  }
  const txt = hl ? '#fff' : COLORS.text;
  const sub = hl ? 'rgba(255,255,255,.85)' : '#7a7a7a';
  const scoreW = 100 * u;
  const innerH = h - 8 * u;
  // Wettbewerb
  setFont(ctx, 400, 16.5 * u);
  ctx.fillStyle = sub; ctx.textAlign = 'left';
  const top = y + pad;
  ctx.fillText(ellipsize(ctx, [m.ageGroup, m.competition].filter(Boolean).join(' | '), w - 2 * pad), x + pad, top + 16.5 * u * 0.8);
  // Teams
  const rowsTop = top + 26 * u, rowGap = (innerH - (rowsTop - y) - pad * 0.6) / 2;
  const logo = 24 * u;
  [m.home, m.away].forEach((t, i) => {
    const cy = rowsTop + rowGap * (i + 0.5);
    if (hl) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + pad + logo / 2, cy, logo * 0.62, 0, Math.PI * 2); ctx.fill(); }
    drawTeamLogo(ctx, scene, t, x + pad + logo / 2, cy, logo);
    setFont(ctx, t.own ? 600 : 400, 22.5 * u);
    ctx.fillStyle = txt;
    ctx.fillText(ellipsize(ctx, t.name, w - pad * 2 - logo - 12 * u - scoreW), x + pad + logo + 12 * u, cy + 22.5 * u * CAP / 2);
  });
  // Datum + Ergebnis
  const sx = x + w - pad;
  ctx.textAlign = 'right';
  setFont(ctx, 400, 16 * u, { track: 0.05 }); ctx.fillStyle = sub;
  const midY = rowsTop + rowGap;
  ctx.fillText(shortDate(m.date), sx, midY - 18 * u);
  const sc = scoreText(m);
  const big = /^\d+:\d+$/.test(sc);
  ctx.fillStyle = hl ? '#fff' : '#3a3a3a';
  const size = fitSize(ctx, sc, 900, (big ? 38 : 26) * u, scoreW - 4 * u, { track: big ? 0.02 : 0 });
  ctx.fillText(sc, sx, midY + 8 * u + size * CAP / 2);
  ctx.textAlign = 'left'; spacing(ctx, 0);
}

function drawPaper(ctx, scene) {
  const { W, H, story } = scene;
  const fr = frame(W, H, story), s = fr.s;
  paperBackground(ctx, W, H, s);

  // Blatt
  const mx = 34 * s, py0 = fr.top + (story ? 10 : 34) * s, py1 = fr.bottom - (story ? 30 : 40) * s;
  ctx.save();
  ctx.translate(W / 2, (py0 + py1) / 2); ctx.rotate(-0.006); ctx.translate(-W / 2, -(py0 + py1) / 2);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30 * s; ctx.shadowOffsetY = 8 * s;
  ctx.fillStyle = '#fbfbfa';
  const r = rng(11);
  ctx.beginPath(); ctx.moveTo(mx, py0); ctx.lineTo(W - mx, py0 - 4 * s); ctx.lineTo(W - mx + 4 * s, py1);
  for (let x = W - mx; x > mx; x -= 18 * s) ctx.lineTo(x, py1 + (r() - 0.5) * 7 * s);
  ctx.lineTo(mx, py1 + 3 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();

  const px0 = mx + 56 * s, px1 = W - mx - 56 * s, pw = px1 - px0;
  const n = scene.matches.length;
  const cols = n <= (story ? 7 : 4) ? 1 : 2;
  const footerH = (story ? 165 : 160) * s;
  const gapY = 22 * s;

  // Kopf – wird bei vielen Spielen kleiner
  let hs = story ? 1.15 : 1;
  let g;
  for (let i = 0; i < 6; i++) {
    const headerH = 395 * s * hs;
    g = grid(n, cols, py1 - footerH - (py0 + headerH + 30 * s), gapY, (cols === 1 ? 150 : 132) * s);
    g.headerH = headerH;
    if (g.rowH >= 112 * s || hs <= 0.62) break;
    hs -= 0.08;
  }

  const title = (scene.title || 'Ergebnisse').toUpperCase();
  const tSize = 235 * s * hs;
  ctx.fillStyle = COLORS.green; ctx.textAlign = 'left';
  setFont(ctx, 900, tSize, { track: -0.01 });
  const sx = Math.min(0.74, (pw * 0.84) / ctx.measureText(title).width);
  const titleW = ctx.measureText(title).width * sx;
  const tx = px1 - titleW - 6 * s, ty = py0 + 40 * s * hs + tSize * CAP;
  condensed(ctx, title, tx, ty, sx);
  if (scene.dateText) {
    const dSize = 128 * s * hs;
    setFont(ctx, 900, dSize, { track: -0.01 });
    const dx = tx + titleW * 0.27, dy = ty + 34 * s * hs + dSize * CAP;
    condensed(ctx, scene.dateText, dx, dy, 0.74);
    drawHash(ctx, dx - 128 * s * hs, dy - dSize * CAP * 0.45, 165 * s * hs);
  } else {
    drawHash(ctx, tx - 40 * s, ty + 60 * s * hs, 150 * s * hs);
  }

  // Spiele
  const gapX = 28 * s;
  const colW = (pw - gapX * (cols - 1)) / cols;
  const gy = py0 + g.headerH + 30 * s;
  const usedH = g.rows * g.rowH + (g.rows - 1) * gapY;
  const y0 = gy + Math.max(0, (py1 - footerH - gy - usedH) / 2);
  const u = Math.min(cols === 1 ? 1.3 : 1.08, g.rowH / (118 * s)) * s * Math.min(1, colW / (430 * s) * 1.08);
  scene.matches.forEach((m, i) => {
    // Spaltenweise füllen (wie im Original: erst links, dann rechts)
    const col = cols === 1 ? 0 : Math.floor(i / g.rows), row = cols === 1 ? i : i % g.rows;
    drawPaperCard(ctx, scene, m, px0 + col * (colW + gapX), y0 + row * (g.rowH + gapY), colW, g.rowH, u, scene.highlights.has(m.id));
  });
  if (!n) emptyNote(ctx, W / 2, (gy + py1 - footerH) / 2, s, COLORS.text);

  // Fuß: Stempel + Vereinslogo
  drawStamp(ctx, scene.footer, px0 + 40 * s, py1 - 26 * s, pw * 0.5, s);
  drawClubLogo(ctx, scene, W - mx - 90 * s, py1 - 70 * s, 170 * s);
}

function emptyNote(ctx, x, y, s, color) {
  ctx.fillStyle = color; ctx.textAlign = 'center'; setFont(ctx, 600, 36 * s);
  ctx.fillText('Keine Spiele ausgewählt', x, y); ctx.textAlign = 'left';
}

// =====================================================================
// Layout „Anzeigetafel“: dunkel, Zeilen mit Alters-Reiter und Ergebnis-Box
// =====================================================================
function boardBackground(ctx, scene, W, H, s) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, '#1d3210'); g.addColorStop(1, '#0d1607');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#fff';
  for (let i = -2; i < 9; i++) {
    const x = i * 190 * s;
    ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H * SLANT, 0); ctx.lineTo(x + H * SLANT + 70 * s, 0); ctx.lineTo(x + 70 * s, H); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  if (scene.images.club) {
    ctx.save(); ctx.globalAlpha = 0.06;
    const sz = W * 0.95;
    ctx.drawImage(scene.images.club, W - sz * 0.62, H - sz * 0.7, sz, sz);
    ctx.restore();
  }
}

function drawBoardRow(ctx, scene, m, x, y, w, h, compact, hl) {
  const s = scene.s;
  const oc = outcome(m);
  const P = h * 0.1;
  // Hintergrund
  ctx.fillStyle = hl ? COLORS.greenLight : 'rgba(255,255,255,.07)';
  slantRect(ctx, x, y, w - h * SLANT, h); ctx.fill();
  const fg = hl ? INK : '#fff', fgSub = hl ? 'rgba(31,45,17,.72)' : 'rgba(255,255,255,.62)';

  // Ergebnis-Box rechts
  const boxH = h - 2 * P, boxW = Math.min(boxH * (compact ? 1.2 : 1.8), 170 * s);
  const bx = x + w - h * SLANT - boxW - P, by = y + P;
  ctx.fillStyle = hl ? INK : '#0a1105';
  slantRect(ctx, bx, by, boxW, boxH); ctx.fill();
  if (!hl && oc) { // Ausgang als farbige Kante unten
    ctx.fillStyle = oc === 'win' ? COLORS.greenLight : oc === 'draw' ? '#b9b9b9' : '#7d7d7d';
    slantRect(ctx, bx, by + boxH - boxH * 0.08, boxW, boxH * 0.08); ctx.fill();
  }
  const sc = scoreText(m), big = /^\d+:\d+$/.test(sc);
  ctx.fillStyle = hl ? COLORS.greenLight : '#fff'; ctx.textAlign = 'center';
  const ss = fitSize(ctx, sc, 700, boxH * (big ? (compact ? 0.5 : 0.62) : 0.32), boxW - boxH * 0.3, { track: big ? 0.02 : 0 });
  ctx.fillText(sc, bx + boxW / 2 + boxH * SLANT / 2, by + boxH / 2 + ss * CAP / 2);
  ctx.textAlign = 'left'; spacing(ctx, 0);

  let nx;
  const date = `${weekday(m.date)} ${shortDate(m.date)}`.toUpperCase();
  if (!compact) {
    // Reiter links: Mannschaft + Datum
    const tagW = Math.min(290 * s, w * 0.3);
    ctx.fillStyle = hl ? INK : COLORS.green;
    slantRect(ctx, x, y, tagW, h); ctx.fill();
    const tx = x + h * SLANT * 0.55 + 18 * s, tw = tagW - h * SLANT * 0.4 - 30 * s;
    ctx.fillStyle = hl ? COLORS.greenLight : '#fff';
    const ls = fitSize(ctx, teamLabel(m).toUpperCase(), 700, h * 0.27, tw, { italic: true }, h * 0.14);
    ctx.fillText(teamLabel(m).toUpperCase(), tx, y + h * 0.47);
    ctx.fillStyle = hl ? 'rgba(118,204,48,.8)' : 'rgba(255,255,255,.75)';
    setFont(ctx, 600, Math.min(ls * 0.75, h * 0.19), { track: 0.06 });
    ctx.fillText(date, tx - h * 0.2 * SLANT, y + h * 0.47 + h * 0.3);
    nx = x + tagW + 20 * s;
  } else {
    nx = x + P + 6 * s;
  }

  // Teams (zwei Zeilen), darüber optional eine Infozeile
  const nameW = bx - nx - 14 * s;
  const meta = compact ? `${teamLabel(m)} · ${date}` : (h >= 104 * s ? m.competition : '');
  const metaH = meta ? h * 0.2 : 0;
  const fs = Math.min(30 * s, (h - 2 * P - metaH) * 0.4);
  const lh = fs * 1.28;
  if (meta) {
    setFont(ctx, 700, metaH * 0.72, { track: 0.08 }); ctx.fillStyle = hl ? INK : COLORS.greenLight;
    ctx.fillText(ellipsize(ctx, meta.toUpperCase(), nameW), nx, y + P + metaH * 0.72);
  }
  const cy0 = y + P + metaH + (h - 2 * P - metaH - 2 * lh) / 2 + lh / 2;
  const logo = fs * 0.95;
  [m.home, m.away].forEach((t, i) => {
    const cy = cy0 + i * lh;
    if (!hl) { ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.arc(nx + logo / 2, cy, logo * 0.64, 0, Math.PI * 2); ctx.fill(); }
    drawTeamLogo(ctx, scene, t, nx + logo / 2, cy, logo);
    setFont(ctx, t.own ? 700 : 400, fs);
    ctx.fillStyle = hl ? INK : t.own ? fg : fgSub;
    ctx.fillText(ellipsize(ctx, t.name, nameW - logo - 14 * s), nx + logo + 14 * s, cy + fs * CAP / 2);
  });
  spacing(ctx, 0);
}

function drawBoard(ctx, scene) {
  const { W, H, story } = scene;
  const fr = frame(W, H, story), s = fr.s;
  boardBackground(ctx, scene, W, H, s);
  const x0 = 60 * s, x1 = W - 60 * s;
  const n = scene.matches.length;

  // Kopf
  const top = fr.top + (story ? 30 : 60) * s;
  const lg = 128 * s;
  drawClubLogo(ctx, scene, x0 + lg / 2, top + lg / 2, lg);
  const hx = x0 + lg + 30 * s;
  ctx.textAlign = 'left';
  setFont(ctx, 700, 22 * s, { track: 0.18 }); ctx.fillStyle = COLORS.greenLight;
  ctx.fillText('SV LIEGAU-AUGUSTUSBAD', hx, top + 26 * s);
  ctx.fillStyle = '#fff';
  const tSize = fitSize(ctx, (scene.title || 'Ergebnisse').toUpperCase(), 900, 104 * s, x1 - hx, { italic: true, track: -0.01 });
  ctx.fillText((scene.title || 'Ergebnisse').toUpperCase(), hx - 4 * s, top + 34 * s + tSize * CAP + 6 * s);
  const dateY = top + 34 * s + tSize * CAP + 24 * s;
  if (scene.dateText) {
    setFont(ctx, 700, 38 * s, { italic: true, track: 0.02 });
    const dw = ctx.measureText(scene.dateText).width + 36 * s;
    ctx.fillStyle = COLORS.greenLight; slantRect(ctx, hx, dateY, dw, 52 * s); ctx.fill();
    ctx.fillStyle = INK; ctx.fillText(scene.dateText, hx + 16 * s + 52 * s * SLANT / 2, dateY + 26 * s + 38 * s * CAP / 2);
  }
  const headBottom = Math.max(top + lg, dateY + 52 * s) + 44 * s;

  // Zeilen
  const footH = scene.footer ? 80 * s : 40 * s;
  const avail = fr.bottom - (story ? 30 : 50) * s - footH - headBottom;
  const gap = 14 * s;
  const oneColMax = story ? 15 : 10;
  const cols = n > oneColMax ? 2 : 1;
  const g = grid(n, cols, avail, gap, (cols === 1 ? 112 : 104) * s);
  const compact = cols === 2 || g.rowH < 64 * s;
  const colGap = 26 * s;
  const colW = (x1 - x0 - colGap * (cols - 1) + (cols > 1 ? g.rowH * SLANT : 0)) / cols;
  const used = g.rows * g.rowH + (g.rows - 1) * gap;
  const y0 = headBottom + Math.max(0, (avail - used) / 2);
  scene.matches.forEach((m, i) => {
    const col = Math.floor(i / g.rows), row = i % g.rows;
    drawBoardRow(ctx, scene, m, x0 + col * (colW + colGap - (cols > 1 ? g.rowH * SLANT : 0)), y0 + row * (g.rowH + gap), colW, g.rowH, compact, scene.highlights.has(m.id));
  });
  if (!n) emptyNote(ctx, W / 2, headBottom + avail / 2, s, '#fff');

  if (scene.footer) {
    setFont(ctx, 700, 28 * s, { italic: true, track: 0.06 });
    ctx.fillStyle = COLORS.greenLight; ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, scene.footer.toUpperCase(), x1 - x0), W / 2, fr.bottom - (story ? 30 : 50) * s - 14 * s);
    ctx.textAlign = 'left';
  }
  spacing(ctx, 0);
}

// =====================================================================
// Layout „Kacheln“: aus Vereinssicht, Sieg/Remis/Niederlage
// =====================================================================
function drawTile(ctx, scene, m, x, y, w, h, hl) {
  const s = scene.s;
  const u = Math.min(h / (230 * s), w / (450 * s)) * s;
  const oc = outcome(m);
  const sd = sides(m);
  ctx.save();
  ctx.shadowColor = 'rgba(20,40,0,.18)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 6 * s;
  ctx.fillStyle = hl ? COLORS.green : '#fff';
  roundRect(ctx, x, y, w, h, 10 * s); ctx.fill();
  ctx.restore();
  if (hl) { ctx.strokeStyle = COLORS.greenLight; ctx.lineWidth = 6 * s; roundRect(ctx, x + 3 * s, y + 3 * s, w - 6 * s, h - 6 * s, 8 * s); ctx.stroke(); }
  const pad = 22 * u;
  // Mannschaft (Reiter)
  const label = teamLabel(m).toUpperCase();
  setFont(ctx, 700, 25 * u, { italic: true, track: 0.02 });
  const lw = Math.min(w * 0.62, ctx.measureText(label).width + 30 * u), lh = 42 * u;
  ctx.fillStyle = hl ? '#fff' : COLORS.green;
  slantRect(ctx, x + pad - 6 * u, y + pad - 4 * u, lw, lh); ctx.fill();
  ctx.fillStyle = hl ? COLORS.green : '#fff';
  ctx.fillText(ellipsize(ctx, label, lw - 26 * u), x + pad + 8 * u + lh * SLANT / 2, y + pad - 4 * u + lh / 2 + 25 * u * CAP / 2);
  // Ausgang
  if (oc) {
    setFont(ctx, 700, 18 * u, { track: 0.1 });
    const t = OUTCOME_LABEL[oc].toUpperCase();
    const tw = ctx.measureText(t).width + 22 * u;
    const bc = hl ? '#fff' : oc === 'win' ? COLORS.green : oc === 'draw' ? '#9a9a9a' : LOSS;
    ctx.strokeStyle = bc; ctx.lineWidth = 2.5 * u; ctx.fillStyle = bc;
    roundRect(ctx, x + w - pad - tw, y + pad, tw, 32 * u, 16 * u);
    if (oc === 'win') { ctx.fill(); ctx.fillStyle = hl ? COLORS.green : '#fff'; } else ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(t, x + w - pad - tw / 2, y + pad + 16 * u + 18 * u * CAP / 2); ctx.textAlign = 'left';
  }
  // Ergebnis aus Vereinssicht
  const sc = sd.score ? `${sd.score[0]}:${sd.score[1]}` : /nichtantritt/i.test(m.status) ? 'Nichtantritt' : scoreText(m);
  const big = !!sd.score;
  ctx.fillStyle = hl ? '#fff' : INK;
  const logo = 36 * u, by = y + h - pad - 6 * u;
  const topEnd = y + pad + 42 * u, botStart = by - 26 * u - 17 * u;
  const room = Math.max(10 * u, botStart - topEnd);
  const scoreSize = fitSize(ctx, sc, 900, Math.min((big ? 112 : 64) * u, room * 0.82 / CAP), (w - 2 * pad) / 0.9, { track: 0.01 });
  ctx.textAlign = 'left';
  condensed(ctx, sc, x + pad - 4 * u, topEnd + room / 2 + scoreSize * CAP / 2, 0.9);
  // Gegner
  ctx.fillStyle = hl ? 'rgba(255,255,255,.85)' : '#7a7a7a';
  setFont(ctx, 600, 17 * u, { track: 0.06 });
  ctx.fillText(`${sd.home ? 'HEIM' : 'AUSWÄRTS'} · ${weekday(m.date).toUpperCase()} ${shortDate(m.date)}`, x + pad + logo + 12 * u, by - 26 * u);
  if (hl) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + pad + logo / 2, by - 14 * u, logo * 0.6, 0, Math.PI * 2); ctx.fill(); }
  drawTeamLogo(ctx, scene, sd.them, x + pad + logo / 2, by - 14 * u, logo);
  setFont(ctx, 600, 22 * u);
  ctx.fillStyle = hl ? '#fff' : COLORS.text;
  ctx.fillText(ellipsize(ctx, `${sd.home ? 'gegen' : 'bei'} ${sd.them.name}`, w - 2 * pad - logo - 12 * u), x + pad + logo + 12 * u, by + 2 * u);
  spacing(ctx, 0);
}

function drawTiles(ctx, scene) {
  const { W, H, story } = scene;
  const fr = frame(W, H, story), s = fr.s;
  ctx.fillStyle = '#eef1ea'; ctx.fillRect(0, 0, W, H);
  // grüne Schräge oben
  const n = scene.matches.length;
  const headH = (story ? 470 : 330) * s + fr.top * 0.6;
  const g0 = ctx.createLinearGradient(0, 0, W, headH);
  g0.addColorStop(0, COLORS.greenDark); g0.addColorStop(1, COLORS.green);
  ctx.fillStyle = g0;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, headH - 90 * s); ctx.lineTo(0, headH + 40 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  ctx.beginPath(); ctx.moveTo(W * 0.52, 0); ctx.lineTo(W * 0.8, 0); ctx.lineTo(W * 0.8 - headH * SLANT, headH); ctx.lineTo(W * 0.52 - headH * SLANT, headH + 20 * s); ctx.closePath(); ctx.fill();

  const x0 = 54 * s, x1 = W - 54 * s;
  const top = fr.top + (story ? 40 : 56) * s;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  setFont(ctx, 700, 24 * s, { track: 0.2 });
  ctx.fillText('SV LIEGAU-AUGUSTUSBAD', x0, top + 20 * s);
  ctx.fillStyle = '#fff';
  const title = (scene.title || 'Ergebnisse').toUpperCase();
  const ts = fitSize(ctx, title, 900, 128 * s, x1 - x0 - 200 * s, { italic: true, track: -0.01 });
  ctx.fillText(title, x0 - 6 * s, top + 44 * s + ts * CAP);
  if (scene.dateText) {
    setFont(ctx, 700, 46 * s, { italic: true });
    ctx.fillStyle = COLORS.greenLight;
    ctx.fillText(scene.dateText, x0, top + 44 * s + ts * CAP + 66 * s);
  }
  drawClubLogo(ctx, scene, x1 - 82 * s, top + 92 * s, 164 * s);

  // Kacheln
  const gy0 = headH + 20 * s;
  const footH = scene.footer ? 70 * s : 20 * s;
  const avail = fr.bottom - (story ? 20 : 44) * s - footH - gy0;
  const gap = 22 * s;
  let cols = n <= 1 ? 1 : n <= (story ? 8 : 6) ? 2 : 3;
  if (story && n > 12) cols = 3;
  let g = grid(n, cols, avail, gap, (cols === 1 ? 300 : 260) * s);
  if (cols === 2 && g.rowH < 150 * s) { cols = 3; g = grid(n, cols, avail, gap, 260 * s); }
  const colW = (x1 - x0 - gap * (cols - 1)) / cols;
  const used = g.rows * g.rowH + (g.rows - 1) * gap;
  const y0 = gy0 + Math.max(0, (avail - used) / 2);
  scene.matches.forEach((m, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    // letzte, unvollständige Zeile zentrieren
    const inRow = Math.min(cols, n - row * cols);
    const off = (cols - inRow) * (colW + gap) / 2;
    drawTile(ctx, scene, m, x0 + off + col * (colW + gap), y0 + row * (g.rowH + gap), colW, g.rowH, scene.highlights.has(m.id));
  });
  if (!n) emptyNote(ctx, W / 2, gy0 + avail / 2, s, COLORS.text);

  if (scene.footer) {
    setFont(ctx, 700, 30 * s, { italic: true, track: 0.04 });
    ctx.fillStyle = COLORS.green; ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, scene.footer.toUpperCase(), x1 - x0), W / 2, fr.bottom - (story ? 20 : 44) * s - 18 * s);
    ctx.textAlign = 'left';
  }
  spacing(ctx, 0);
}

// =====================================================================
// Highlight: ein Spiel groß, mit Überschrift und kurzem Text, optional Foto
// =====================================================================
export function defaultHeadline(m) {
  if (!m) return '';
  const oc = outcome(m);
  return oc === 'win' ? 'Sieg!' : oc === 'draw' ? 'Unentschieden' : oc === 'loss' ? 'Niederlage' : 'Spielbericht';
}

function coverImage(ctx, img, W, H, fx = 0, fy = 0) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = Math.max(W / iw, H / ih);
  const dw = iw * sc, dh = ih * sc;
  ctx.drawImage(img, (W - dw) / 2 + fx * (dw - W) / 2, (H - dh) / 2 + fy * (dh - H) / 2, dw, dh);
}

function drawHighlight(ctx, scene) {
  const { W, H, story } = scene;
  const fr = frame(W, H, story), s = fr.s;
  const hl = scene.hl || {};
  const m = hl.match;
  const photo = hl.photo;
  // Hintergrund
  if (photo) {
    coverImage(ctx, photo, W, H, 0, hl.photoY || 0);
    const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
    g.addColorStop(0, 'rgba(10,18,5,0)'); g.addColorStop(0.55, 'rgba(10,18,5,.62)'); g.addColorStop(1, 'rgba(10,18,5,.92)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    g2.addColorStop(0, 'rgba(10,18,5,.5)'); g2.addColorStop(1, 'rgba(10,18,5,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H * 0.25);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, COLORS.greenDark); g.addColorStop(1, COLORS.green);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.moveTo(W * 0.5, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.5 - H * SLANT, H); ctx.closePath(); ctx.fill();
    if (scene.images.club) { ctx.save(); ctx.globalAlpha = 0.07; const sz = W * 1.1; ctx.drawImage(scene.images.club, W - sz * 0.6, -sz * 0.18, sz, sz); ctx.restore(); }
  }
  const x0 = 64 * s, x1 = W - 64 * s, cw = x1 - x0;
  const top = fr.top + (story ? 40 : 60) * s;
  drawClubLogo(ctx, scene, x1 - 66 * s, top + 66 * s, 132 * s);
  if (!m) { emptyNote(ctx, W / 2, H / 2, s, '#fff'); return; }

  // Kopf: Mannschaft + Wettbewerb + Datum
  setFont(ctx, 700, 34 * s, { italic: true, track: 0.04 });
  const tag = teamLabel(m).toUpperCase();
  const tagW = ctx.measureText(tag).width + 44 * s, tagH = 58 * s;
  ctx.fillStyle = COLORS.greenLight; slantRect(ctx, x0, top + 20 * s, tagW, tagH); ctx.fill();
  ctx.fillStyle = INK; ctx.fillText(tag, x0 + 20 * s + tagH * SLANT / 2, top + 20 * s + tagH / 2 + 34 * s * CAP / 2);
  setFont(ctx, 600, 28 * s, { track: 0.03 }); ctx.fillStyle = '#fff';
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 10 * s;
  const d = parseIso(m.date);
  const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  ctx.fillText(ellipsize(ctx, m.competition || '', cw - 170 * s), x0, top + 20 * s + tagH + 48 * s);
  ctx.fillText(dateStr, x0, top + 20 * s + tagH + 88 * s);
  ctx.restore();

  // Blöcke von unten nach oben: Text-Karte, Ergebnis-Panel, Überschrift
  const bottom = fr.bottom - (story ? 30 : 60) * s;
  // Text
  setFont(ctx, 600, 34 * s);
  const textLines = hl.text ? wrapLines(ctx, hl.text, cw - 80 * s, story ? 7 : 5) : [];
  const textH = textLines.length ? textLines.length * 46 * s + 64 * s : 0;
  // Ergebnis-Panel
  const panelH = 330 * s;
  // Überschrift
  const head = (hl.headline || '').trim();
  const headSize = 104 * s;
  const headH = head ? headSize * 1.2 : 0;
  const gap = 28 * s;
  const total = textH + panelH + headH + (textH ? gap : 0) + (headH ? gap : 0);
  const minTop = top + 20 * s + tagH + 120 * s;
  let y = photo ? bottom - total : Math.max(minTop, minTop + (bottom - minTop - total) / 2);
  y = Math.max(minTop, y);

  if (head) {
    ctx.save();
    setFont(ctx, 900, headSize, { italic: true, track: -0.01 });
    const hs = fitSize(ctx, head.toUpperCase(), 900, headSize, cw - 40 * s, { italic: true, track: -0.01 });
    const hw = ctx.measureText(head.toUpperCase()).width + 50 * s, hh = hs * 1.18;
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 24 * s; ctx.shadowOffsetY = 6 * s;
    ctx.fillStyle = COLORS.green; slantRect(ctx, x0, y + headH - hh, hw, hh); ctx.fill();
    ctx.restore();
    setFont(ctx, 900, hs, { italic: true, track: -0.01 });
    ctx.fillStyle = '#fff';
    ctx.fillText(head.toUpperCase(), x0 + 22 * s + hh * SLANT / 2, y + headH - hh / 2 + hs * CAP / 2);
    y += headH + gap;
  }

  // Panel: Logos, Namen, Ergebnis
  ctx.save();
  ctx.fillStyle = photo ? 'rgba(255,255,255,.96)' : '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 30 * s; ctx.shadowOffsetY = 8 * s;
  roundRect(ctx, x0, y, cw, panelH, 10 * s); ctx.fill();
  ctx.restore();
  const colW = cw * 0.31;
  const logo = 150 * s;
  [[m.home, x0 + colW / 2 + 10 * s], [m.away, x1 - colW / 2 - 10 * s]].forEach(([t, cx]) => {
    drawTeamLogo(ctx, scene, t, cx, y + 40 * s + logo / 2, logo);
    setFont(ctx, t.own ? 700 : 600, 25 * s);
    ctx.fillStyle = t.own ? COLORS.green : COLORS.text; ctx.textAlign = 'center';
    const lines = wrapLines(ctx, t.name, colW, 2);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + 40 * s + logo + 44 * s + i * 30 * s));
  });
  const sc = scoreText(m), big = /^\d+:\d+$/.test(sc);
  ctx.fillStyle = INK; ctx.textAlign = 'center';
  const ss = fitSize(ctx, sc, 900, (big ? 190 : 100) * s, cw - 2 * colW - 20 * s, { track: 0 });
  condensed(ctx, sc, x0 + cw / 2, y + panelH / 2 + ss * CAP / 2 - 10 * s, 0.92, 'center');
  ctx.textAlign = 'left';
  y += panelH + gap;

  // Text-Karte
  if (textLines.length) {
    ctx.fillStyle = photo ? 'rgba(13,22,7,.78)' : 'rgba(13,22,7,.35)';
    roundRect(ctx, x0, y, cw, textH, 10 * s); ctx.fill();
    ctx.fillStyle = COLORS.greenLight; ctx.fillRect(x0, y, 10 * s, textH);
    setFont(ctx, 600, 34 * s); ctx.fillStyle = '#fff';
    textLines.forEach((l, i) => ctx.fillText(l, x0 + 44 * s, y + 32 * s + 46 * s * (i + 0.5) + 34 * s * CAP / 2));
  }
  spacing(ctx, 0);
}

// ---------- Einstieg ----------
const DRAW = { paper: drawPaper, board: drawBoard, tiles: drawTiles, highlight: drawHighlight };

/**
 * scene = { layout, W, H, story, matches, highlights:Set, title, dateText, footer,
 *           images:{ club, logos:Map<id,Image> }, hl:{ match, headline, text, photo, photoY } }
 */
export function drawResults(ctx, scene) {
  scene = { ...scene, s: scene.W / 1080, highlights: scene.highlights || new Set() };
  ctx.save();
  ctx.clearRect(0, 0, scene.W, scene.H);
  ctx.textBaseline = 'alphabetic';
  (DRAW[scene.layout] || drawPaper)(ctx, scene);
  ctx.restore();
}
