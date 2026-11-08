// Logo-Animationen: zerlegt das Hallencup-Logo in Ebenen, animiert sie auf einem Canvas
// und nimmt das Ergebnis als Video auf (MP4, falls der Browser es kann, sonst WebM).
//
//   const scene = await prepareScene(layersData, { W: 1080, H: 1080, bg: 'gruen' });
//   drawFrame(ctx, scene, 'mid', 1.5);              // Bild bei t = 1,5 s
//   const { blob } = await recordAnimation(scene, 'exciting', { onProgress });

import { recorderMimes, baseMime, makeThumb } from '../create/export.js';

export const FORMATS = {
  square: { label: 'Quadrat 1:1', W: 1080, H: 1080 },
  story: { label: 'Story 9:16', W: 1080, H: 1920 },
};

export const BACKGROUNDS = {
  gruen: { label: 'Grün' },
  weiss: { label: 'Weiß' },
  dunkel: { label: 'Dunkel' },
};

const GREEN = '#3e9800', GREEN_DARK = '#33691e', GREEN_LIGHT = '#76cc30';

/* ------------------------------------------------------------ Easing */
const clamp01 = x => Math.max(0, Math.min(1, x));
/** Fortschritt 0..1 zwischen a und b */
const prog = (t, a, b) => clamp01((t - a) / (b - a));
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
const easeInCubic = x => x * x * x;
const easeInOutCubic = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const easeOutElastic = x => (x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1);
const lerp = (a, b, x) => a + (b - a) * x;

/** Reproduzierbarer Zufall – Vorschau und Video sehen gleich aus. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------ Vorbereitung */

const svgUrl = svg => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Logo-Ebene konnte nicht geladen werden'));
    img.src = url;
  });
}

/** Begrenzungsrahmen jeder Ebene in viewBox-Koordinaten (über das DOM gemessen). */
function measureLayers(layers) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;height:600px;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    return layers.map(l => {
      host.innerHTML = l.svg;
      const svg = host.querySelector('svg');
      // Nur Inhalt messen, <defs>/<title> ignorieren
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const el of svg.children) {
        if (el.tagName === 'defs' || el.tagName === 'title') continue;
        try {
          const b = el.getBBox();
          if (!b.width && !b.height) continue;
          // Transform des Elements (z. B. verschobene Schleife) berücksichtigen
          const m = el.transform?.baseVal?.consolidate()?.matrix;
          const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
            .map(([x, y]) => (m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [x, y]));
          for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
        } catch { /* nicht messbar */ }
      }
      return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
    });
  } finally {
    host.remove();
  }
}

/**
 * Szene vorbereiten: Ebenen in Zielauflösung rastern und zuschneiden.
 * @param {{box:number[], layers:{id,svg}[]}} data  von buildHallencupLayers()
 * @param {{W:number, H:number, bg:string, scale?:number}} opts  scale < 1 für eine kleine Vorschau
 */
export async function prepareScene(data, { W, H, bg = 'gruen', scale = 1 }) {
  const [bx, by, bw, bh] = data.box;
  const fw = Math.round(W * scale), fh = Math.round(H * scale);
  // Logo-Größe im Bild: Quadrat ≈ 80 % Höhe, Story ≈ 80 % Breite
  const k = Math.min((fw * 0.8) / bw, (fh * (fh > fw ? 0.62 : 0.8)) / bh);
  const lw = bw * k, lh = bh * k;
  const ox = (fw - lw) / 2;
  const oy = (fh - lh) / 2 - (fh > fw ? fh * 0.03 : 0);
  const boxes = measureLayers(data.layers);

  const parts = {};
  const order = [];
  await Promise.all(data.layers.map(async (layer, i) => {
    const b = boxes[i];
    if (!b) return;
    const url = svgUrl(layer.svg);
    try {
      const img = await loadImg(url);
      try { await img.decode?.(); } catch { /* egal */ }
      await new Promise(r => setTimeout(r, 30)); // Safari: eingebettete Bilder
      const pad = 4;
      const sx = Math.max(0, Math.floor((b.x - bx) * k - pad)), sy = Math.max(0, Math.floor((b.y - by) * k - pad));
      const sw = Math.min(Math.ceil(lw) - sx, Math.ceil(b.w * k + pad * 2)), sh = Math.min(Math.ceil(lh) - sy, Math.ceil(b.h * k + pad * 2));
      // Erst ganze Ebene rastern, dann zuschneiden (SVG-Bilder lassen sich nicht zuverlässig ausschneiden)
      const full = document.createElement('canvas');
      full.width = Math.ceil(lw); full.height = Math.ceil(lh);
      const fx = full.getContext('2d');
      fx.imageSmoothingQuality = 'high';
      fx.drawImage(img, 0, 0, lw, lh);
      const c = document.createElement('canvas');
      c.width = Math.max(1, sw); c.height = Math.max(1, sh);
      c.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      full.width = full.height = 1;
      parts[layer.id] = { img: c, x: ox + sx, y: oy + sy, w: sw, h: sh, cx: ox + sx + sw / 2, cy: oy + sy + sh / 2, order: i };
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
  for (const l of data.layers) if (parts[l.id]) order.push(l.id);
  const stars = order.filter(id => id.startsWith('star'));
  return {
    W: fw, H: fh, bg, parts, order, stars,
    logo: { x: ox, y: oy, w: lw, h: lh, cx: ox + lw / 2, cy: oy + lh / 2 },
    u: fw / 1080, // Einheit für Pixelwerte (Vorschau kleiner)
    scratch: document.createElement('canvas'),
  };
}

/* ------------------------------------------------------------ Zeichen-Helfer */

/**
 * Ebene mit Transformation zeichnen.
 * o: { tx, ty, s, sx, sy, r (rad), a (alpha), wipe (0..1 von links aufdecken), shine (−1..2 Glanzposition) }
 */
function drawPart(ctx, scene, id, o = {}) {
  const p = scene.parts[id];
  if (!p) return;
  const a = o.a ?? 1;
  if (a <= 0.001) return;
  const sx = o.sx ?? o.s ?? 1, sy = o.sy ?? o.s ?? 1;
  if (Math.abs(sx) < 0.001 || Math.abs(sy) < 0.001) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.translate(p.cx + (o.tx || 0), p.cy + (o.ty || 0));
  if (o.r) ctx.rotate(o.r);
  ctx.scale(sx, sy);
  ctx.translate(-p.cx, -p.cy);
  if (o.wipe != null && o.wipe < 1) {
    ctx.beginPath();
    ctx.rect(p.x, p.y - 2, p.w * clamp01(o.wipe), p.h + 4);
    ctx.clip();
  }
  if (o.shine != null && o.shine > -0.5 && o.shine < 1.5) {
    // Glanzstreifen nur auf den Pixeln der Ebene
    const c = scene.scratch;
    if (c.width !== p.w || c.height !== p.h) { c.width = p.w; c.height = p.h; }
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, p.w, p.h);
    x.drawImage(p.img, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    const cx = lerp(-0.3, 1.3, o.shine) * p.w;
    const band = Math.max(40 * scene.u, p.w * 0.12);
    const g = x.createLinearGradient(cx - band, 0, cx + band * 0.6, p.h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, p.w, p.h);
    ctx.drawImage(c, p.x, p.y);
  } else {
    ctx.drawImage(p.img, p.x, p.y);
  }
  ctx.restore();
}

function drawBackground(ctx, scene, t, { rays = 0, pulse = 0 } = {}) {
  const { W, H, bg } = scene;
  const cx = W / 2, cy = scene.logo.cy;
  const R = Math.hypot(W, H) * 0.6;
  let inner, outer, rayColor;
  if (bg === 'weiss') { inner = '#ffffff'; outer = '#e9efe4'; rayColor = 'rgba(118,204,48,'; }
  else if (bg === 'dunkel') { inner = '#2a3d17'; outer = '#0d1407'; rayColor = 'rgba(118,204,48,'; }
  else { inner = '#5fb81c'; outer = '#1f4d0a'; rayColor = 'rgba(255,255,255,'; }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (rays > 0) {
    // Rotierende Lichtstrahlen
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.25);
    const n = 14;
    for (let i = 0; i < n; i++) {
      ctx.rotate((Math.PI * 2) / n);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -0.09, 0.09);
      ctx.closePath();
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      rg.addColorStop(0, `${rayColor}${0.22 * rays})`);
      rg.addColorStop(1, `${rayColor}0)`);
      ctx.fillStyle = rg;
      ctx.fill();
    }
    ctx.restore();
  }
  if (pulse > 0) {
    const pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, scene.logo.w * 0.8);
    pg.addColorStop(0, `rgba(255,255,255,${0.35 * pulse})`);
    pg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, W, H);
  }
}

/** Alle Ebenen mit denselben Werten zeichnen (für „lame“). */
function drawAll(ctx, scene, o) {
  for (const id of scene.order) drawPart(ctx, scene, id, o);
}

/** Kamera: Zoom um die Logo-Mitte + Wackeln. */
function camera(ctx, scene, { s = 1, shake = 0, t = 0 }) {
  const { cx, cy } = scene.logo;
  const amp = shake * 22 * scene.u;
  ctx.translate(cx + Math.sin(t * 91) * amp, cy + Math.cos(t * 77) * amp);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
}

/** Abklingender Stoß nach einem Aufprall bei tImpact. */
const impact = (t, tImpact, dur = 0.35) => (t < tImpact ? 0 : Math.max(0, 1 - (t - tImpact) / dur) ** 2);

/* ------------------------------------------------------------ Varianten */

function drawLame(ctx, scene, t) {
  drawBackground(ctx, scene, t);
  const p = easeOutCubic(prog(t, 0.2, 1.4));
  ctx.save();
  camera(ctx, scene, { s: lerp(0.94, 1, p) });
  drawAll(ctx, scene, { a: p });
  ctx.restore();
}

function drawMid(ctx, scene, t) {
  drawBackground(ctx, scene, t);
  const S = scene, u = S.u;
  const breathe = t > 3.2 ? 1 + Math.sin((t - 3.2) * 2.4) * 0.012 : 1;
  ctx.save();
  camera(ctx, S, { s: breathe });

  const pb = prog(t, 0.0, 0.55);
  drawPart(ctx, S, 'badge', { s: easeOutBack(pb) , a: clamp01(pb * 3) });

  const pe = prog(t, 0.3, 1.1);
  drawPart(ctx, S, 'emblem', { s: easeOutBack(pe, 1.4), r: (1 - easeOutCubic(pe)) * -Math.PI, a: clamp01(pe * 3) });

  const pr = easeOutCubic(prog(t, 2.0, 2.5));
  drawPart(ctx, S, 'ribbon', { ty: (1 - pr) * 60 * u, a: pr });
  drawPart(ctx, S, 'date', { wipe: easeInOutCubic(prog(t, 2.25, 2.9)) });

  const pn = prog(t, 0.95, 1.5);
  const bx = (1 - easeOutBack(pn, 1.2)) * -S.W;
  const shine = t > 3.3 ? prog(t, 3.3, 4.1) * 1.6 - 0.3 : null;
  drawPart(ctx, S, 'banner', { tx: bx, shine });
  drawPart(ctx, S, 'bannerText', { tx: bx, wipe: easeInOutCubic(prog(t, 1.3, 1.85)) });

  const ps = easeOutCubic(prog(t, 1.75, 2.2));
  drawPart(ctx, S, 'subtitle', { ty: (1 - ps) * 18 * u, a: ps });
  S.stars.forEach((id, i) => {
    const p = prog(t, 1.75 + i * 0.13, 2.1 + i * 0.13);
    drawPart(ctx, S, id, { s: easeOutBack(p, 2.4), r: (1 - p) * Math.PI, a: clamp01(p * 4) });
  });
  ctx.restore();
}

/** Konfetti-/Funken-Daten einmal pro Szene erzeugen. */
function particles(scene) {
  if (scene._fx) return scene._fx;
  const r = rng(1951);
  const colors = [GREEN, GREEN_LIGHT, '#ffffff', GREEN_DARK, '#d8f5b8'];
  const confetti = Array.from({ length: 240 }, (_, i) => {
    const left = i % 2 === 0;
    return {
      x0: left ? -0.02 : 1.02, y0: 0.75 + r() * 0.3,
      vx: (left ? 1 : -1) * (0.25 + r() * 0.55), vy: -(1.1 + r() * 0.9),
      rot: r() * 6, vr: (r() - 0.5) * 14, w: 18 + r() * 18, h: 10 + r() * 10,
      color: colors[Math.floor(r() * colors.length)], delay: r() * 0.6, wobble: r() * 6,
    };
  });
  const sparks = Array.from({ length: 14 }, () => ({ ang: r() * Math.PI * 2, sp: 0.6 + r() * 0.8, size: 3 + r() * 4 }));
  scene._fx = { confetti, sparks };
  return scene._fx;
}

function drawConfetti(ctx, scene, t, t0) {
  if (t < t0) return;
  const { confetti } = particles(scene);
  const { W, H, u } = scene;
  for (const c of confetti) {
    const tt = t - t0 - c.delay;
    if (tt <= 0) continue;
    const x = (c.x0 + c.vx * tt * 0.75) * W + Math.sin(tt * 5 + c.wobble) * 18 * u;
    const y = (c.y0 + c.vy * tt * 0.75 + 0.55 * tt * tt) * H;
    if (y > H + 40 || x < -60 || x > W + 60) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(c.rot + c.vr * tt);
    ctx.scale(1, Math.cos(tt * 9 + c.wobble)); // Flattern
    ctx.fillStyle = c.color;
    ctx.globalAlpha = clamp01(3.2 - tt) * 0.95;
    ctx.fillRect((-c.w / 2) * u, (-c.h / 2) * u, c.w * u, c.h * u);
    ctx.restore();
  }
}

function drawSparks(ctx, scene, part, t, t0) {
  const p = scene.parts[part];
  if (!p || t < t0 || t > t0 + 0.6) return;
  const { sparks } = particles(scene);
  const x = (t - t0) / 0.6;
  ctx.save();
  ctx.fillStyle = scene.bg === 'weiss' ? GREEN_LIGHT : '#ffffff';
  ctx.globalAlpha = 1 - x;
  for (const s of sparks) {
    const d = easeOutCubic(x) * s.sp * 70 * scene.u;
    const r = s.size * (1 - x) * scene.u;
    ctx.beginPath();
    ctx.arc(p.cx + Math.cos(s.ang) * d, p.cy + Math.sin(s.ang) * d, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function shockwave(ctx, scene, t, t0) {
  if (t < t0 || t > t0 + 0.6) return;
  const x = (t - t0) / 0.6;
  const { cx, cy, w } = scene.logo;
  ctx.save();
  ctx.strokeStyle = scene.bg === 'weiss' ? GREEN : '#ffffff';
  ctx.globalAlpha = (1 - x) * 0.8;
  ctx.lineWidth = (14 * (1 - x) + 1) * scene.u;
  ctx.beginPath();
  ctx.arc(cx, cy - scene.logo.h * 0.12, w * (0.25 + easeOutCubic(x) * 0.9), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawExciting(ctx, scene, t) {
  const S = scene, u = S.u;
  const hits = [0.75, 1.65];
  const shake = Math.max(impact(t, hits[0]), impact(t, hits[1]) * 0.8);
  const beat = t > 3.4 ? Math.max(0, Math.sin((t - 3.4) * Math.PI * 1.6)) ** 6 : 0;
  drawBackground(ctx, S, t, { rays: easeOutCubic(prog(t, 0.6, 1.6)), pulse: shake * 0.8 + beat * 0.3 });

  ctx.save();
  camera(ctx, S, { s: (t < 0.75 ? 1.06 : 1) * (1 + beat * 0.025), shake, t });

  // Wappen fliegt mit Drehung aus der Tiefe heran (mit Nachzieh-Schatten)
  const pe = prog(t, 0.0, 0.75);
  const emblemAt = x => ({ s: lerp(5, 1, easeInCubic(x)), r: (1 - easeOutCubic(x)) * Math.PI * 3, a: clamp01(x * 4) });
  if (pe < 1) for (let k = 3; k >= 1; k--) {
    const g = emblemAt(Math.max(0, pe - k * 0.05));
    drawPart(ctx, S, 'emblem', { ...g, a: g.a * 0.18 });
  }

  // Badge springt elastisch auf
  const pb = prog(t, 0.8, 1.6);
  drawPart(ctx, S, 'badge', { s: easeOutElastic(pb), a: clamp01(pb * 5) });
  drawPart(ctx, S, 'emblem', emblemAt(pe));
  shockwave(ctx, S, t, hits[0]);

  // Schleife klappt auf, Datum erscheint
  const pr = prog(t, 2.35, 2.85);
  drawPart(ctx, S, 'ribbon', { sx: easeOutBack(pr, 2), sy: easeOutBack(pr, 1.2), a: clamp01(pr * 4) });
  drawPart(ctx, S, 'date', { wipe: easeOutCubic(prog(t, 2.7, 3.2)) });

  // Banner knallt aus Richtung Kamera herein
  const pn = prog(t, 1.3, 1.65);
  const shine = t > 1.9 ? ((t - 1.9) % 1.4) / 0.9 * 1.6 - 0.3 : null;
  const bannerO = { s: lerp(2.6, 1, easeInCubic(pn)), a: clamp01(pn * 3) };
  drawPart(ctx, S, 'banner', { ...bannerO, shine });
  drawPart(ctx, S, 'bannerText', { ...bannerO, wipe: t < 1.6 ? 0 : easeOutCubic(prog(t, 1.65, 2.05)) });

  // Zusatzzeile + Sterne mit Funken
  const ps = easeOutBack(prog(t, 2.0, 2.4), 2);
  drawPart(ctx, S, 'subtitle', { s: ps, a: clamp01(ps * 2) });
  S.stars.forEach((id, i) => {
    const t0 = 2.05 + i * 0.16;
    const p = prog(t, t0, t0 + 0.3);
    const pop = t > 3.4 ? 1 + beat * 0.25 : 1;
    drawPart(ctx, S, id, { s: easeOutBack(p, 3) * pop, r: (1 - p) * Math.PI * 2, a: clamp01(p * 4) });
    drawSparks(ctx, S, id, t, t0 + 0.2);
  });
  ctx.restore();

  // Blitz beim Aufprall
  if (shake > 0) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = shake * 0.55;
    ctx.fillRect(0, 0, S.W, S.H);
    ctx.restore();
  }
  drawConfetti(ctx, S, t, 3.3);
}

export const VARIANTS = {
  lame: { label: 'lame', hint: 'Ruhiges Einblenden', duration: 3.5, draw: drawLame },
  mid: { label: 'mid', hint: 'Teile bauen sich nacheinander auf', duration: 5, draw: drawMid },
  exciting: { label: 'exciting', hint: 'Knall, Lichtstrahlen und Konfetti', duration: 7, draw: drawExciting },
};

export function drawFrame(ctx, scene, variant, t) {
  ctx.save();
  ctx.clearRect(0, 0, scene.W, scene.H);
  (VARIANTS[variant] || VARIANTS.mid).draw(ctx, scene, t);
  ctx.restore();
}

/* ------------------------------------------------------------ Aufnahme */

const FPS = 30;
const HOLD_END = 0.3; // kurzes Halten am Ende

const abortError = () => { const e = new Error('Abgebrochen'); e.name = 'AbortError'; return e; };

let muxerPromise;
/** mp4-muxer (UMD) per <script> laden → window.Mp4Muxer. */
function loadMuxer() {
  if (globalThis.Mp4Muxer?.Muxer) return Promise.resolve(globalThis.Mp4Muxer);
  muxerPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/mp4-muxer.min.js', import.meta.url).href;
    s.onload = () => (globalThis.Mp4Muxer?.Muxer ? resolve(globalThis.Mp4Muxer) : reject(new Error('mp4-muxer nicht verfügbar')));
    s.onerror = () => reject(new Error('mp4-muxer konnte nicht geladen werden'));
    document.head.append(s);
  }).catch(e => { muxerPromise = null; throw e; });
  return muxerPromise;
}

/** Passende H.264-Einstellung für WebCodecs finden (oder null). */
async function findAvcConfig(W, H) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.420028']) {
    const config = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: 'avc' } };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return r.config || config;
    } catch { /* nächster */ }
  }
  return null;
}

/**
 * Animation als Video erzeugen.
 * Bevorzugt WebCodecs (bildgenau, schneller als Echtzeit, immer MP4);
 * sonst Aufnahme in Echtzeit über MediaRecorder.
 * @returns {Promise<{blob: Blob, thumb: Blob, mime: string}>}
 */
export async function recordAnimation(scene, variant, opts = {}) {
  const config = await findAvcConfig(scene.W, scene.H);
  if (config) {
    try {
      const Mp4Muxer = await loadMuxer();
      return await encodeWebCodecs(scene, variant, config, Mp4Muxer, opts);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      console.warn('WebCodecs fehlgeschlagen, nutze MediaRecorder', err);
    }
  }
  return recordRealtime(scene, variant, opts);
}

/** Kurz an den Browser abgeben – ohne setTimeout (das wird im Hintergrund stark gebremst). */
const yieldNow = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
/** Warten, bis der Encoder ein Bild abgearbeitet hat. */
function waitDequeue(encoder) {
  if (!('ondequeue' in encoder)) return yieldNow();
  return new Promise(r => {
    const done = () => { clearTimeout(timer); encoder.removeEventListener('dequeue', done); r(); };
    const timer = setTimeout(done, 50);
    encoder.addEventListener('dequeue', done);
  });
}

async function encodeWebCodecs(scene, variant, config, Mp4Muxer, { onProgress, isCancelled } = {}) {
  const V = VARIANTS[variant] || VARIANTS.mid;
  const canvas = document.createElement('canvas');
  canvas.width = scene.W; canvas.height = scene.H;
  const ctx = canvas.getContext('2d');

  drawFrame(ctx, scene, variant, V.duration);
  const thumb = await makeThumb(canvas);

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: scene.W, height: scene.H, frameRate: FPS },
    fastStart: 'in-memory',
  });
  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encError = e; },
  });
  encoder.configure(config);

  const frames = Math.round((V.duration + HOLD_END) * FPS);
  const frameUs = 1_000_000 / FPS;
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled?.()) throw abortError();
      if (encError) throw encError;
      drawFrame(ctx, scene, variant, Math.min(i / FPS, V.duration));
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      onProgress?.((i + 1) / frames * 0.95);
      // Encoder nicht überlaufen lassen; UI zwischendurch atmen lassen
      while (encoder.encodeQueueSize > 6) await waitDequeue(encoder);
      if (i % 10 === 9) await yieldNow();
    }
    await encoder.flush();
    if (encError) throw encError;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    canvas.width = canvas.height = 1;
  }
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  if (!blob.size) throw new Error('Leeres Video');
  onProgress?.(1);
  return { blob, thumb, mime: 'video/mp4' };
}

/** Rückfall: Animation in Echtzeit mit MediaRecorder aufnehmen. */
async function recordRealtime(scene, variant, { onProgress, isCancelled } = {}) {
  const V = VARIANTS[variant] || VARIANTS.mid;
  const duration = V.duration;
  const canvas = document.createElement('canvas');
  canvas.width = scene.W; canvas.height = scene.H;
  // Manche Browser liefern nur Frames für Canvas im Dokument
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  try {
    drawFrame(ctx, scene, variant, duration);
    const thumb = await makeThumb(canvas);
    drawFrame(ctx, scene, variant, 0);

    // Bilder möglichst einzeln an den Recorder geben (requestFrame), sonst feste 30 fps
    let stream = canvas.captureStream(0);
    let track = stream.getVideoTracks()[0];
    if (typeof track?.requestFrame !== 'function') {
      stream.getTracks().forEach(t => t.stop());
      stream = canvas.captureStream(30);
      track = null;
    }
    const pushFrame = () => track?.requestFrame();
    let rec = null, lastErr;
    const candidates = recorderMimes(false);
    for (const mimeType of candidates) {
      try { rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 }); break; }
      catch (e) { lastErr = e; }
    }
    if (!rec) throw lastErr || new Error('Videoaufnahme wird von diesem Browser nicht unterstützt');

    const chunks = [];
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise(r => rec.addEventListener('stop', r, { once: true }));
    const started = new Promise(r => rec.addEventListener('start', r, { once: true }));
    rec.start(500);

    // Vorlauf: der Recorder braucht einen Moment, bis er Bilder annimmt.
    // So lange das Startbild zeigen, damit vom Anfang nichts verloren geht.
    // Der Recorder verschluckt je nach Gerät die ersten ~0,5 s → großzügiger Vorlauf.
    const LEAD = 1.0;
    await Promise.race([started, new Promise(r => setTimeout(r, 1000))]);
    const total = LEAD + duration + HOLD_END;
    const t0 = performance.now();
    let cancelled = false;
    await new Promise(resolve => {
      let done = false, last = 0;
      const finish = () => { done = true; clearInterval(guard); resolve(); };
      const paint = () => {
        const t = (performance.now() - t0) / 1000;
        drawFrame(ctx, scene, variant, Math.min(Math.max(0, t - LEAD), duration));
        pushFrame();
        last = performance.now();
        onProgress?.(Math.min(1, t / total));
        return t;
      };
      const tick = () => {
        if (done) return;
        if (isCancelled?.()) { cancelled = true; finish(); return; }
        if (paint() >= total) { finish(); return; }
        requestAnimationFrame(tick);
      };
      // Sicherheitsnetz, falls requestAnimationFrame pausiert (Tab im Hintergrund) – zeichnet nur, startet keine neue Schleife
      const guard = setInterval(() => {
        if (done) return;
        if (isCancelled?.()) { cancelled = true; finish(); return; }
        if (performance.now() - last > 60 && paint() >= total) finish();
      }, 1000 / 30);
      requestAnimationFrame(tick);
    });

    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getTracks().forEach(t => t.stop());
    if (cancelled) throw abortError();
    const mime = baseMime(rec.mimeType || candidates[0]);
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error('Leeres Video – Aufnahme fehlgeschlagen');
    onProgress?.(1);
    return { blob, thumb, mime };
  } finally {
    canvas.remove();
    canvas.width = canvas.height = 1;
  }
}
