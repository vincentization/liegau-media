// Social-Media-Generator: Foto/Video laden → gestalten → in mehreren Formaten exportieren.
import { toast, html, esc, slug, loadImage, useStyles, shareOrDownload, downloadBlob, canShareFiles, formatBytes, openSheet } from '../util.js';
import { ensureFonts } from '../brand.js';
import { saveItem } from '../storage.js';
import { FORMATS, groupsFor, groupToken, groupLabel } from '../create/formats.js';
import { STYLES, drawScene, frameGeometry } from '../create/render.js';
import { loadLogo, resetLogoCache, logoKeys } from '../create/logos.js';
import { exportImage, recordVideo, canRecordVideo, willProduceMp4, MAX_VIDEO_SECONDS } from '../create/export.js';

export const title = 'Erstellen';

const STORE_KEY = 'svl.create.settings';
const DEFAULTS = {
  formats: ['wa-status', 'ig-story', 'ig-post'],
  style: 'bar',
  texts: { eyebrow: '', headline: '', info: '' },
  textPos: 'bottom',
  logo: 'club',
  logoPos: 'tr',
  logoSize: 0.2,
  muted: false,
};
const EYEBROW_SUGGESTIONS = ['Spieltag', 'Ergebnis', 'Hallencup 2026', 'Nachwuchs', 'Vorschau', 'Danke'];
const MAX_SRC_PX = 3200;     // große Fotos vorab verkleinern (flüssige Vorschau)
const PREVIEW_PX = 1100;     // längste Seite der Vorschau

let S = null; // Zustand der aktuell gemounteten View

// ---------- Einstellungen ----------
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw) return structuredClone(DEFAULTS);
    const s = { ...structuredClone(DEFAULTS), ...raw, texts: { ...DEFAULTS.texts, ...(raw.texts || {}) } };
    s.formats = (s.formats || []).filter(id => FORMATS.some(f => f.id === id));
    if (!s.formats.length) s.formats = [...DEFAULTS.formats];
    return s;
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  clearTimeout(saveSettings._t);
  saveSettings._t = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.settings)); } catch { /* egal */ }
  }, 300);
}

// ---------- Markup ----------
const ICON_UPLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="15.5" cy="9" r="1.6" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function template(st) {
  const t = st.texts;
  return html`
<div class="cr">
  <input type="file" accept="image/*,video/*" class="cr-file" hidden>

  <section class="cr-start" data-when="empty">
    <div class="hero cr-hero">
      <p class="eyebrow">Foto/Video posten</p>
      <h1>Foto oder Video in Vereinsoptik</h1>
      <p>Text und Logo drauf, fertig für WhatsApp, Instagram &amp; Facebook.</p>
    </div>
    <label class="dropzone cr-drop" data-act="pick" tabindex="0" role="button">
      <span class="cr-drop-icon">${ICON_UPLOAD}</span>
      <strong>Foto oder Video wählen</strong>
      <span class="small">Antippen – oder Datei hierher ziehen</span>
    </label>
    <button type="button" class="btn btn-ghost btn-block cr-nophoto" data-act="nophoto">Ohne Foto – nur Text auf Grün</button>
  </section>

  <section class="cr-editor" data-when="media" hidden>
    <div class="cr-layout">
      <div class="cr-col-preview">
        <div class="card cr-media">
          <div class="cr-step"><span>1</span><h2>Medium</h2></div>
          <div class="cr-media-row">
            <div class="cr-media-info"><strong class="cr-media-name"></strong><span class="small muted cr-media-meta"></span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-act="pick">Ändern</button>
          </div>
          <div class="cr-video" hidden>
            <div class="cr-trim">
              <button type="button" class="cr-play" data-act="play" aria-label="Vorschau abspielen">${ICON_PLAY}</button>
              <div class="cr-trim-sliders">
                <label class="cr-slider"><span>Start <b data-out="start">0,0 s</b></span><input type="range" data-in="trimStart" min="0" max="1" step="0.1" value="0"></label>
                <label class="cr-slider"><span>Ende <b data-out="end">0,0 s</b></span><input type="range" data-in="trimEnd" min="0" max="1" step="0.1" value="1"></label>
              </div>
            </div>
            <p class="small cr-trim-info" data-out="length"></p>
            <label class="check"><input type="checkbox" data-in="muted"${st.muted ? ' checked' : ''}> <span>Ton entfernen (stumm)</span></label>
            <p class="cr-note" data-out="videonote" hidden></p>
          </div>
        </div>

        <div class="card cr-preview">
          <div class="cr-step"><span>2</span><h2>Gestalten</h2></div>
          <div class="cr-tabs" role="tablist" aria-label="Vorschau-Format"></div>
          <div class="stage cr-stage">
            <canvas class="cr-canvas" aria-label="Vorschau – ziehen zum Verschieben"></canvas>
          </div>
          <p class="cr-hint small muted">Bild mit dem Finger verschieben, mit zwei Fingern zoomen.</p>
          <div class="cr-frame-tools">
            <label class="cr-slider cr-zoom"><span>Zoom</span><input type="range" data-in="zoom" min="1" max="4" step="0.01" value="1"></label>
            <button type="button" class="btn btn-ghost btn-sm" data-act="resetframe">Zurücksetzen</button>
          </div>
          <div class="cr-seg" role="group" aria-label="Bildausschnitt">
            <button type="button" class="chip" data-fit="cover">Ausfüllen</button>
            <button type="button" class="chip" data-fit="blur">Ganzes Bild</button>
          </div>
        </div>
      </div>

      <div class="cr-col-controls">
        <details class="card cr-sec" open>
          <summary><span class="label">Formate</span><span class="cr-sum" data-out="formatsum"></span></summary>
          <div class="chips cr-formats">
            ${FORMATS.map(f => `<button type="button" class="chip" data-format="${f.id}" aria-pressed="false"><span>${esc(f.label)}</span><small>${f.w}×${f.h}</small></button>`).join('')}
          </div>
        </details>

        <details class="card cr-sec" open>
          <summary><span class="label">Vorlage</span><span class="cr-sum" data-out="stylesum"></span></summary>
          <div class="cr-styles">
            ${STYLES.map(s => `<button type="button" class="cr-style" data-style="${s.id}" aria-pressed="false"><span class="cr-mini cr-mini-${s.id}"><i></i><b></b><em></em></span><span>${esc(s.label)}</span></button>`).join('')}
          </div>
        </details>

        <details class="card cr-sec cr-texts" open>
          <summary><span class="label">Texte</span><span class="cr-sum" data-out="textsum"></span></summary>
          <p class="small muted cr-notext" hidden>Vorlage „Ohne Text“ gewählt – die Texte werden nicht angezeigt.</p>
          <label class="field"><span>Kleine Zeile</span><input type="text" data-text="eyebrow" maxlength="40" placeholder="z. B. SPIELTAG" value="${esc(t.eyebrow)}" autocomplete="off"></label>
          <div class="cr-suggest">${EYEBROW_SUGGESTIONS.map(s => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
          <label class="field"><span>Überschrift</span><textarea data-text="headline" rows="2" maxlength="120" placeholder="z. B. Heimsieg gegen Ottendorf!">${esc(t.headline)}</textarea></label>
          <label class="field"><span>Unterzeile / Infos</span><textarea data-text="info" rows="2" maxlength="160" placeholder="z. B. Sa, 14.11. · 14:00 Uhr · Sportplatz Liegau">${esc(t.info)}</textarea></label>
          <span class="label">Position</span>
          <div class="cr-seg" role="group" aria-label="Textposition">
            <button type="button" class="chip" data-textpos="top">Oben</button>
            <button type="button" class="chip" data-textpos="middle">Mitte</button>
            <button type="button" class="chip" data-textpos="bottom">Unten</button>
          </div>
        </details>

        <details class="card cr-sec" open>
          <summary><span class="label">Logo</span><span class="cr-sum" data-out="logosum"></span></summary>
          <div class="cr-seg cr-seg-4" role="group" aria-label="Logo">
            <button type="button" class="chip" data-logo="club">Verein</button>
            <button type="button" class="chip" data-logo="cup">Hallencup</button>
            <button type="button" class="chip" data-logo="both">Beide</button>
            <button type="button" class="chip" data-logo="none">Keins</button>
          </div>
          <div class="cr-logo-opts">
            <div>
              <span class="label">Ecke</span>
              <div class="cr-corners" role="group" aria-label="Logo-Position">
                <button type="button" data-logopos="tl" aria-label="oben links"></button>
                <button type="button" data-logopos="tr" aria-label="oben rechts"></button>
                <button type="button" data-logopos="bl" aria-label="unten links"></button>
                <button type="button" data-logopos="br" aria-label="unten rechts"></button>
              </div>
            </div>
            <label class="cr-slider"><span>Größe <b data-out="logosize"></b></span><input type="range" data-in="logoSize" min="0.1" max="0.4" step="0.01" value="${st.logoSize}"></label>
          </div>
        </details>

        <div class="card cr-export">
          <div class="cr-step"><span>3</span><h2>Exportieren</h2></div>
          <p class="small muted" data-out="exportinfo"></p>
          <button type="button" class="btn btn-block cr-go" data-act="export">Erstellen</button>
          <div class="cr-progress" hidden>
            <div class="progress"><div></div></div>
            <div class="cr-progress-row"><span class="small" data-out="progress">Wird erstellt …</span><button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Abbrechen</button></div>
          </div>
          <div class="cr-results"></div>
        </div>
      </div>
    </div>
  </section>
</div>`;
}

// ---------- Mount ----------
export async function mount(el) {
  useStyles('css/views/create.css');
  resetLogoCache();
  const root = template(loadSettings());
  S = {
    root, el,
    settings: loadSettings(),
    media: null,           // { kind:'image'|'video'|'none', src, w, h, name, size, url, video, duration }
    trim: { start: 0, end: 0 },
    frames: {},            // pro Gruppe: { x, y, zoom, fit }
    activeKey: null,
    logoImgs: {},
    urls: new Set(),
    results: [],
    exporting: false,
    cancel: false,
    raf: 0,
    playing: false,
    audioCtx: null,
    exportVideo: null,
    alive: true,
  };
  el.append(root);
  const $ = sel => root.querySelector(sel);
  S.$ = $;
  S.canvas = $('.cr-canvas');
  S.ctx = S.canvas.getContext('2d');

  bindEvents();
  syncControls();
  ensureFonts().then(redraw);
  ensureLogos();
}

export function unmount() {
  if (!S) return;
  const st = S;
  S = null;
  st.alive = false;
  st.cancel = true;
  cancelAnimationFrame(st.raf);
  try { st.media?.video?.pause(); st.media?.video?.removeAttribute('src'); st.media?.video?.load(); } catch { /* */ }
  try { st.exportVideo?.pause(); st.exportVideo?.removeAttribute('src'); } catch { /* */ }
  try { st.audioCtx?.close(); } catch { /* */ }
  st.urls.forEach(u => URL.revokeObjectURL(u));
  clearTimeout(saveSettings._t);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(st.settings)); } catch { /* */ }
}

function objectUrl(blob) {
  const u = URL.createObjectURL(blob);
  S.urls.add(u);
  return u;
}
function revoke(u) { if (u) { URL.revokeObjectURL(u); S?.urls.delete(u); } }

// ---------- Events ----------
function bindEvents() {
  const { root, $ } = S;
  const fileInput = $('.cr-file');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) openFile(f);
  });

  root.addEventListener('click', e => {
    const t = e.target.closest('button, [data-act]');
    if (!t || !root.contains(t)) return;
    const st = S.settings;
    if (t.dataset.act === 'pick') { e.preventDefault(); if (!S.exporting) fileInput.click(); return; }
    if (t.dataset.act === 'nophoto') { setMedia({ kind: 'none', name: 'Ohne Foto', w: 0, h: 0 }); return; }
    if (t.dataset.act === 'play') { togglePlay(); return; }
    if (t.dataset.act === 'resetframe') { const f = frameFor(S.activeKey); f.x = 0; f.y = 0; f.zoom = 1; syncControls(); redraw(); return; }
    if (t.dataset.act === 'export') { runExport(); return; }
    if (t.dataset.act === 'cancel') { S.cancel = true; return; }
    if (t.dataset.act === 'shareall') { shareAll(); return; }
    if (t.dataset.result != null) { resultAction(t); return; }
    if (t.dataset.format) {
      const id = t.dataset.format;
      if (st.formats.includes(id)) {
        if (st.formats.length === 1) { toast('Mindestens ein Format auswählen'); return; }
        st.formats = st.formats.filter(x => x !== id);
      } else st.formats = [...st.formats, id];
      changed();
      return;
    }
    if (t.dataset.tab) { S.activeKey = t.dataset.tab; syncControls(); redraw(); return; }
    if (t.dataset.fit) { frameFor(S.activeKey).fit = t.dataset.fit; frameFor(S.activeKey).zoom = 1; syncControls(); redraw(); return; }
    if (t.dataset.style) { st.style = t.dataset.style; changed(); return; }
    if (t.dataset.textpos) { st.textPos = t.dataset.textpos; changed(); return; }
    if (t.dataset.logo) { st.logo = t.dataset.logo; ensureLogos(); changed(); return; }
    if (t.dataset.logopos) { st.logoPos = t.dataset.logopos; changed(); return; }
    if (t.dataset.suggest) { st.texts.eyebrow = t.dataset.suggest.toLocaleUpperCase('de-DE'); $('[data-text="eyebrow"]').value = st.texts.eyebrow; changed(); return; }
  });

  root.addEventListener('keydown', e => {
    if (e.target.matches('.cr-drop') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileInput.click(); }
  });

  root.addEventListener('input', e => {
    const t = e.target;
    const st = S.settings;
    if (t.dataset.text) { st.texts[t.dataset.text] = t.value; changed(false); return; }
    switch (t.dataset.in) {
      case 'zoom': frameFor(S.activeKey).zoom = +t.value; redraw(); break;
      case 'logoSize': st.logoSize = +t.value; changed(false); break;
      case 'muted': st.muted = t.checked; if (S.media?.video) S.media.video.muted = st.muted; changed(false); break;
      case 'trimStart': case 'trimEnd': onTrim(t.dataset.in, +t.value); break;
    }
  });

  // Drag & Drop (Desktop)
  const drop = $('.cr-drop');
  ['dragenter', 'dragover'].forEach(ev => root.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'dragend'].forEach(ev => root.addEventListener(ev, e => { if (!root.contains(e.relatedTarget)) drop.classList.remove('is-over'); }));
  root.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f && !S.exporting) openFile(f);
  });

  bindCanvasGestures();
}

/** Nach Einstellungsänderung: speichern, Bedienelemente + Vorschau aktualisieren. */
function changed(sync = true) {
  saveSettings();
  if (sync) syncControls(); else syncSummaries();
  redraw();
}

// ---------- Medium laden ----------
const isHeic = f => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

async function openFile(file) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || isHeic(file) || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
  if (!isVideo && !isImage) { toast('Bitte ein Foto oder Video auswählen', { error: true }); return; }
  try {
    if (isVideo) await openVideo(file); else await openImage(file);
  } catch (err) {
    console.warn(err);
    if (isHeic(file)) toast('HEIC-Fotos kann dieser Browser nicht öffnen. Bitte als JPG teilen oder in Safari öffnen.', { error: true, ms: 5000 });
    else if (isVideo) toast('Dieses Video kann der Browser nicht abspielen (Format nicht unterstützt).', { error: true, ms: 4500 });
    else toast('Foto konnte nicht geöffnet werden.', { error: true });
  }
}

async function openImage(file) {
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
  let src = img, w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('Bild leer');
  const r = MAX_SRC_PX / Math.max(w, h);
  if (r < 1) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  setMedia({ kind: 'image', src, w, h, name: file.name, size: file.size });
}

function waitEvent(el, ok, bad = 'error', ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('Zeitüberschreitung')); }, ms);
    const onOk = () => { cleanup(); resolve(); };
    const onBad = () => { cleanup(); reject(el.error || new Error('Medienfehler')); };
    function cleanup() { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener(bad, onBad); }
    el.addEventListener(ok, onOk); el.addEventListener(bad, onBad);
  });
}

async function openVideo(file) {
  const url = objectUrl(file);
  const v = document.createElement('video');
  v.className = 'cr-hidden-video';
  v.playsInline = true; v.setAttribute('playsinline', ''); v.muted = true; v.preload = 'auto';
  v.src = url;
  S.root.append(v);
  try {
    await waitEvent(v, 'loadedmetadata');
    let dur = v.duration;
    if (!isFinite(dur)) { // manche WebM ohne Dauer
      v.currentTime = 1e7; await waitEvent(v, 'durationchange', 'error', 5000).catch(() => {});
      dur = isFinite(v.duration) ? v.duration : 0; v.currentTime = 0;
    }
    if (!v.videoWidth || !dur) throw new Error('Video ohne Bild');
    if (v.readyState < 2) await waitEvent(v, 'loadeddata', 'error', 8000).catch(() => {});
    v.muted = S.settings.muted;
    setMedia({ kind: 'video', src: v, video: v, url, w: v.videoWidth, h: v.videoHeight, name: file.name, size: file.size, duration: dur, file });
  } catch (e) { v.remove(); revoke(url); throw e; }
  v.addEventListener('seeked', redraw);
  v.addEventListener('timeupdate', () => {
    if (!S || S.exporting) return;
    if (!v.paused && v.currentTime >= S.trim.end) { v.currentTime = S.trim.start; }
  });
  v.addEventListener('pause', () => setPlaying(false));
  v.addEventListener('play', () => setPlaying(true));
  if (duration() > MAX_VIDEO_SECONDS) toast(`Videos dürfen max. ${MAX_VIDEO_SECONDS} s lang sein – bitte Ausschnitt wählen.`, { ms: 4000 });
  v.currentTime = Math.min(0.05, S.media.duration / 2);
}
const duration = () => S.media?.duration || 0;

function setMedia(m) {
  const old = S.media;
  if (old?.video && old.video !== m.video) { old.video.pause(); old.video.remove(); revoke(old.url); }
  S.media = m;
  S.frames = {};
  clearResults();
  if (m.kind === 'video') S.trim = { start: 0, end: Math.min(m.duration, MAX_VIDEO_SECONDS) };
  S.$('[data-when="empty"]').hidden = true;
  S.$('[data-when="media"]').hidden = false;
  syncControls();
  redraw();
  window.scrollTo({ top: 0 });
}

// ---------- Video: Trimmen & Abspielen ----------
const fmtS = s => s.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';

function onTrim(which, val) {
  const d = duration();
  let { start, end } = S.trim;
  if (which === 'trimStart') {
    start = Math.min(val, d - 0.5);
    end = Math.min(Math.max(end, start + 0.5), start + MAX_VIDEO_SECONDS, d);
  } else {
    end = Math.max(val, 0.5);
    start = Math.max(Math.min(start, end - 0.5), end - MAX_VIDEO_SECONDS, 0);
  }
  S.trim = { start, end };
  const v = S.media.video;
  v.pause();
  v.currentTime = which === 'trimStart' ? start : Math.max(start, end - 0.05);
  syncVideo();
}

function togglePlay() {
  const v = S.media?.video; if (!v) return;
  if (v.paused) {
    if (v.currentTime < S.trim.start || v.currentTime >= S.trim.end - 0.05) v.currentTime = S.trim.start;
    v.muted = S.settings.muted;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  } else v.pause();
}

function setPlaying(p) {
  if (!S) return;
  S.playing = p;
  const b = S.$('[data-act="play"]');
  b.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
  b.setAttribute('aria-label', p ? 'Pause' : 'Vorschau abspielen');
  if (p) loop();
}
function loop() {
  if (!S || !S.playing) return;
  drawPreview();
  S.raf = requestAnimationFrame(loop);
}

// ---------- Bildausschnitt ----------
function frameFor(key) {
  if (!S.frames[key]) {
    const g = groupsFor(S.settings.formats).find(x => x.key === key);
    const m = S.media;
    // Querformat-Foto in Story → standardmäßig ganzes Bild mit unscharfem Hintergrund
    const auto = g && m?.w && (m.w / m.h) > 1.15 && (g.w / g.h) < 0.8 ? 'blur' : 'cover';
    S.frames[key] = { x: 0, y: 0, zoom: 1, fit: auto };
  }
  return S.frames[key];
}

function bindCanvasGestures() {
  const c = S.canvas;
  const pts = new Map();
  let pinch = null;
  const toOut = () => { const g = activeGroup(); const r = c.getBoundingClientRect(); return g ? g.w / r.width : 1; };
  const clampFrame = () => {
    const g = activeGroup(), m = S.media; if (!g || !m?.w) return;
    const f = frameFor(g.key);
    const geo = frameGeometry(g.w, g.h, m.w, m.h, f.fit, f);
    f.x = geo.x; f.y = geo.y;
  };
  c.addEventListener('pointerdown', e => {
    if (!S.media?.w) return;
    c.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: frameFor(S.activeKey).zoom };
    }
    c.classList.add('is-dragging');
  });
  c.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const f = frameFor(S.activeKey);
    if (pts.size === 1) {
      const k = toOut();
      f.x += (e.clientX - p.x) * k; f.y += (e.clientY - p.y) * k;
      clampFrame();
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      f.zoom = Math.min(4, Math.max(1, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      clampFrame();
      S.$('[data-in="zoom"]').value = f.zoom;
    }
    redraw();
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) c.classList.remove('is-dragging');
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => {
    if (!S.media?.w) return;
    e.preventDefault();
    const f = frameFor(S.activeKey);
    f.zoom = Math.min(4, Math.max(1, f.zoom * Math.exp(-e.deltaY * 0.0015)));
    clampFrame();
    S.$('[data-in="zoom"]').value = f.zoom;
    redraw();
  }, { passive: false });
}

// ---------- Vorschau ----------
const activeGroup = () => groupsFor(S.settings.formats).find(g => g.key === S.activeKey);

function sceneFor(group, src) {
  const st = S.settings, m = S.media, f = frameFor(group.key);
  return {
    W: group.w, H: group.h, story: group.story,
    src: m?.kind === 'none' ? null : src, srcW: m?.w, srcH: m?.h,
    fit: f.fit, frame: f,
    style: st.style, texts: st.texts, textPos: st.textPos,
    logos: logoKeys(st.logo).map(k => S.logoImgs[k]).filter(Boolean),
    logoPos: st.logoPos, logoSize: st.logoSize,
  };
}

function redraw() {
  if (!S || S.playing) return; // während Wiedergabe zeichnet die Schleife
  cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame(() => S && drawPreview());
}

function drawPreview() {
  const g = activeGroup();
  if (!g || !S.media) return;
  const p = Math.min(1, PREVIEW_PX / Math.max(g.w, g.h));
  const cw = Math.round(g.w * p), ch = Math.round(g.h * p);
  const c = S.canvas;
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; c.style.aspectRatio = `${g.w} / ${g.h}`; }
  const ctx = S.ctx;
  ctx.setTransform(p, 0, 0, p, 0, 0);
  drawScene(ctx, sceneFor(g, S.media.src));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

async function ensureLogos() {
  const keys = logoKeys(S.settings.logo).filter(k => !S.logoImgs[k]);
  for (const k of keys) {
    try { S.logoImgs[k] = await loadLogo(k); }
    catch (e) { console.warn(e); toast('Logo konnte nicht geladen werden', { error: true }); }
  }
  if (keys.length && S) redraw();
}

// ---------- Bedienelemente synchronisieren ----------
function setPressed(sel, attr, value) {
  S.root.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(typeof value === 'function' ? value(b.dataset[attr]) : b.dataset[attr] === value)));
}

function syncControls() {
  const st = S.settings, $ = S.$;
  const groups = groupsFor(st.formats);
  if (!groups.some(g => g.key === S.activeKey)) S.activeKey = groups[0]?.key;

  setPressed('[data-format]', 'format', id => st.formats.includes(id));
  setPressed('[data-style]', 'style', st.style);
  setPressed('[data-textpos]', 'textpos', st.textPos);
  setPressed('[data-logo]', 'logo', st.logo);
  setPressed('[data-logopos]', 'logopos', st.logoPos);

  // Tabs der Vorschau
  const tabs = $('.cr-tabs');
  tabs.innerHTML = groups.map(g => `<button type="button" role="tab" class="cr-tab" data-tab="${g.key}" aria-selected="${g.key === S.activeKey}" title="${esc(groupLabel(g))}">
      <span class="cr-tab-shape" style="aspect-ratio:${g.w}/${g.h}"></span>
      <span><b>${esc(g.tab)} ${esc(g.ratio)}</b><small>${esc(g.formats.map(f => f.short).join(' · '))}</small></span></button>`).join('');
  tabs.classList.toggle('is-compact', groups.length > 2);
  tabs.hidden = groups.length < 2;

  const f = S.activeKey && S.media ? frameFor(S.activeKey) : { zoom: 1, fit: 'cover' };
  $('[data-in="zoom"]').value = f.zoom;
  setPressed('[data-fit]', 'fit', f.fit);
  const hasImage = !!S.media?.w;
  $('.cr-frame-tools').hidden = !hasImage;
  $('.cr-preview .cr-seg').hidden = !hasImage;
  $('.cr-hint').hidden = !hasImage;
  S.canvas.classList.toggle('is-draggable', hasImage);

  $('.cr-notext').hidden = st.style !== 'none';
  S.root.querySelector('.cr-texts').classList.toggle('is-off', st.style === 'none');
  $('.cr-logo-opts').hidden = st.logo === 'none';

  syncMedia();
  syncSummaries();
}

function syncSummaries() {
  const st = S.settings, $ = S.$;
  $('[data-out="formatsum"]').textContent = `${st.formats.length} gewählt`;
  $('[data-out="stylesum"]').textContent = STYLES.find(s => s.id === st.style)?.label || '';
  $('[data-out="textsum"]').textContent = st.texts.headline.trim() ? `„${st.texts.headline.trim().slice(0, 22)}${st.texts.headline.trim().length > 22 ? '…' : ''}“` : '';
  $('[data-out="logosum"]').textContent = { club: 'Verein', cup: 'Hallencup', both: 'Beide', none: 'Keins' }[st.logo];
  $('[data-out="logosize"]').textContent = Math.round(st.logoSize * 100) + ' %';
  const groups = groupsFor(st.formats);
  const n = groups.length;
  const isVid = S.media?.kind === 'video';
  $('[data-out="exportinfo"]').textContent = isVid
    ? `${n} ${n === 1 ? 'Video' : 'Videos'} (${groups.map(g => g.name).join(', ')}). Das Erstellen dauert so lange wie das Video${n > 1 ? ' – je Format' : ''}. App dabei geöffnet lassen.`
    : `${n} ${n === 1 ? 'Bild' : 'Bilder'} als JPG: ${groups.map(g => g.name).join(', ')}.`;
}

function syncMedia() {
  const m = S.media, $ = S.$;
  if (!m) return;
  $('.cr-media-name').textContent = m.name || '';
  const parts = [];
  if (m.kind === 'image') parts.push('Foto', `${m.w}×${m.h}`);
  if (m.kind === 'video') parts.push('Video', fmtS(m.duration), `${m.w}×${m.h}`);
  if (m.kind === 'none') parts.push('Grüner Hintergrund');
  if (m.size) parts.push(formatBytes(m.size));
  $('.cr-media-meta').textContent = parts.join(' · ');
  $('.cr-video').hidden = m.kind !== 'video';
  if (m.kind === 'video') syncVideo();
}

function syncVideo() {
  const $ = S.$, d = duration(), { start, end } = S.trim;
  const a = $('[data-in="trimStart"]'), b = $('[data-in="trimEnd"]');
  a.max = b.max = d.toFixed(2);
  a.value = start; b.value = end;
  $('[data-out="start"]').textContent = fmtS(start);
  $('[data-out="end"]').textContent = fmtS(end);
  const len = end - start;
  $('[data-out="length"]').textContent = `Länge: ${fmtS(len)}${d > MAX_VIDEO_SECONDS ? ` (max. ${MAX_VIDEO_SECONDS} s)` : ''}`;
  const note = $('[data-out="videonote"]');
  if (!canRecordVideo()) { note.hidden = false; note.textContent = 'Dieser Browser kann leider keine Videos erstellen. Bitte aktuelles Chrome oder Safari verwenden.'; }
  else if (!willProduceMp4()) { note.hidden = false; note.textContent = 'Hinweis: Dieser Browser speichert Videos als WebM. WhatsApp und Instagram möchten MP4 – am besten Safari (iPhone) oder aktuelles Chrome verwenden.'; }
  else note.hidden = true;
}

// ---------- Export ----------
function setProgress(frac, text) {
  const $ = S.$;
  $('.cr-progress .progress > div').style.width = `${Math.round(frac * 100)}%`;
  if (text) $('[data-out="progress"]').textContent = text;
}

function setExporting(on) {
  S.exporting = on;
  const $ = S.$;
  $('.cr-progress').hidden = !on;
  $('.cr-go').disabled = on;
  $('.cr-go').textContent = on ? 'Wird erstellt …' : 'Erstellen';
  S.root.querySelectorAll('.cr-col-controls details, .cr-media button, .cr-media input').forEach(x => x.toggleAttribute('inert', on));
  S.root.classList.toggle('is-exporting', on);
}

async function runExport() {
  if (S.exporting || !S.media) return;
  const st = S.settings, m = S.media;
  const groups = groupsFor(st.formats);
  if (!groups.length) { toast('Bitte mindestens ein Format wählen'); return; }
  const isVideo = m.kind === 'video';
  if (isVideo && !canRecordVideo()) { toast('Videos erstellen geht in diesem Browser nicht.', { error: true }); return; }

  // Audio + Export-Video synchron im Klick vorbereiten (Autoplay-Regeln von iOS/Safari).
  let audioTrack = null, ev = null, unlock = null;
  if (isVideo) {
    ev = document.createElement('video');
    ev.playsInline = true; ev.setAttribute('playsinline', ''); ev.preload = 'auto';
    ev.className = 'cr-hidden-video';
    ev.src = m.url;
    S.root.append(ev);
    S.exportVideo = ev;
    if (!st.muted) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        S.audioCtx ||= new AC();
        S.audioCtx.resume();
        const srcNode = S.audioCtx.createMediaElementSource(ev);
        const dest = S.audioCtx.createMediaStreamDestination();
        srcNode.connect(dest);
        audioTrack = dest.stream.getAudioTracks()[0] || null;
      } catch (e) { console.warn('Ton nicht verfügbar', e); ev.muted = true; }
    } else ev.muted = true;
    // „Entsperrt“ das Element für späteres play() ohne Nutzergeste.
    unlock = ev.play().then(() => ev.pause()).catch(() => {});
  }

  m.video?.pause();
  S.cancel = false;
  clearResults();
  setExporting(true);
  setProgress(0, 'Wird vorbereitet …');
  const snapshot = { texts: { ...st.texts }, style: st.style, textPos: st.textPos, logo: { choice: st.logo, pos: st.logoPos, size: st.logoSize } };
  const headline = st.texts.headline.trim().replace(/\s+/g, ' ');
  let archiveFailed = false, made = 0;

  try {
    await ensureFonts();
    await ensureLogos();
    if (isVideo) {
      await Promise.race([unlock, new Promise(r => setTimeout(r, 3000))]);
      ev.pause();
      if (ev.readyState < 1) await waitEvent(ev, 'loadedmetadata').catch(() => {});
      if (ev.readyState < 2) await waitEvent(ev, 'loadeddata', 'error', 8000).catch(() => {});
    }
    for (let i = 0; i < groups.length; i++) {
      if (S.cancel) throw Object.assign(new Error('Abgebrochen'), { name: 'AbortError' });
      const g = groups[i];
      const label = `${g.name} (${i + 1}/${groups.length})`;
      let out;
      if (!isVideo) {
        setProgress(i / groups.length, `${label} …`);
        await new Promise(r => setTimeout(r, 30)); // UI aktualisieren lassen
        out = await exportImage(g.w, g.h, ctx => drawScene(ctx, sceneFor(g, m.src)));
      } else {
        const { start, end } = S.trim;
        out = await recordVideo({
          video: ev, W: g.w, H: g.h, start, end, audioTrack,
          draw: ctx => drawScene(ctx, sceneFor(g, ev)),
          onProgress: p => S && setProgress((i + p) / groups.length, `${label} · ${fmtS(p * (end - start))} von ${fmtS(end - start)}`),
          isCancelled: () => !S || S.cancel,
        });
      }
      if (!S) return;
      const ext = out.mime === 'image/jpeg' ? 'jpg' : out.mime === 'video/mp4' ? 'mp4' : 'webm';
      const filename = `sv-liegau_${slug(headline || 'beitrag')}_${groupToken(g)}.${ext}`;
      const res = { group: g, ...out, filename, url: objectUrl(out.blob), thumbUrl: objectUrl(out.thumb) };
      S.results.push(res);
      made++;
      renderResults();
      try {
        await saveItem({
          kind: isVideo ? 'video' : 'image',
          format: g.formats[0].id,
          formatLabel: groupLabel(g),
          title: headline || 'Ohne Titel',
          mime: out.mime, width: g.w, height: g.h, size: out.blob.size,
          blob: out.blob, thumb: out.thumb,
          meta: { ...snapshot, formats: g.formats.map(f => f.id), frame: { ...frameFor(g.key) }, ...(isVideo ? { trim: { ...S.trim }, muted: st.muted } : {}) },
        });
      } catch (e) { console.warn('Archiv:', e); archiveFailed = true; }
    }
    setProgress(1, 'Fertig!');
    toast(archiveFailed ? `Fertig – ${made} Datei${made > 1 ? 'en' : ''} erstellt (Archiv nicht verfügbar)` : `Fertig – ${made} Datei${made > 1 ? 'en' : ''} erstellt und im Archiv gespeichert`, { ms: 3500 });
    S.$('.cr-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    if (!S) return;
    if (e?.name === 'AbortError') toast('Abgebrochen');
    else { console.error(e); toast('Fehler beim Erstellen: ' + (e?.message || e), { error: true, ms: 5000 }); }
  } finally {
    if (S) {
      setExporting(false);
      if (ev) { ev.pause(); ev.remove(); }
      S.exportVideo = null;
      if (S.audioCtx) { S.audioCtx.close().catch(() => {}); S.audioCtx = null; }
      redraw();
    }
  }
}

function clearResults() {
  for (const r of S.results) { revoke(r.url); revoke(r.thumbUrl); }
  S.results = [];
  renderResults();
}

function renderResults() {
  const box = S.$('.cr-results');
  const rs = S.results;
  if (!rs.length) { box.innerHTML = ''; return; }
  const files = rs.map(r => new File([r.blob], r.filename, { type: r.mime }));
  const multi = rs.length > 1 && canShareFiles(files);
  const webm = rs.some(r => r.mime === 'video/webm');
  box.innerHTML = `
    <h3>Fertig zum Teilen</h3>
    ${webm ? '<p class="cr-note">Videos wurden als WebM gespeichert. WhatsApp/Instagram nehmen evtl. nur MP4 an – dann bitte Safari oder aktuelles Chrome nutzen.</p>' : ''}
    <ul class="cr-result-list">
      ${rs.map((r, i) => `
      <li class="cr-result">
        <button type="button" class="cr-thumb${r.mime.startsWith('video/') ? ' is-video' : ''}" data-result="${i}" data-op="view" aria-label="Ansehen">
          <img src="${r.thumbUrl}" alt="" style="aspect-ratio:${r.group.w}/${r.group.h}">
        </button>
        <div class="cr-result-body">
          <strong>${esc(r.group.name)}</strong>
          <span class="small muted">${esc(r.group.formats.map(f => f.label).join(' · '))}</span>
          <span class="small muted">${r.mime === 'image/jpeg' ? 'JPG' : r.mime === 'video/mp4' ? 'MP4' : 'WebM'} · ${r.group.w}×${r.group.h} · ${formatBytes(r.blob.size)}</span>
          <div class="cr-result-btns">
            <button type="button" class="btn btn-blue btn-sm" data-result="${i}" data-op="share">${ICON_SHARE}Teilen</button>
            <button type="button" class="btn btn-secondary btn-sm" data-result="${i}" data-op="save">${ICON_SAVE}Speichern</button>
          </div>
        </div>
      </li>`).join('')}
    </ul>
    ${multi ? `<button type="button" class="btn btn-blue btn-block" data-act="shareall">${ICON_SHARE}Alle teilen (${rs.length})</button>` : ''}`;
}

async function resultAction(btn) {
  const r = S.results[+btn.dataset.result];
  if (!r) return;
  const op = btn.dataset.op;
  if (op === 'save') { downloadBlob(r.blob, r.filename); return; }
  if (op === 'share') {
    const how = await shareOrDownload(r.blob, r.filename, { title: 'SV Liegau' });
    if (how === 'downloaded') toast('Datei gespeichert');
    return;
  }
  if (op === 'view') {
    const body = r.mime.startsWith('video/')
      ? html`<video class="cr-sheet-media" src="${r.url}" controls playsinline autoplay></video>`
      : html`<img class="cr-sheet-media" src="${r.url}" alt="">`;
    openSheet(r.group.name, body);
  }
}

async function shareAll() {
  const files = S.results.map(r => new File([r.blob], r.filename, { type: r.mime }));
  try { await navigator.share({ files, title: 'SV Liegau' }); }
  catch (e) { if (e?.name !== 'AbortError') { console.warn(e); toast('Teilen nicht möglich – bitte einzeln speichern', { error: true }); } }
}
