// Logo-Tab: Hallencup-Logo für die nächste Ausgabe anpassen und exportieren.
import { html, esc, toast, useStyles, canvasToBlob, shareOrDownload, slug, loadImage } from '../util.js';
import { setHallencupLogoSvg } from '../brand.js';
import { buildHallencupSvg, buildHallencupLayers, loadLogoResources, formatDateRange, bannerText, normalizeOptions, DEFAULTS } from '../hallencup-logo.js';
import { VARIANTS, FORMATS, BACKGROUNDS, prepareScene, drawFrame, recordAnimation } from '../logo/animate.js';
import { canRecordVideo, willProduceMp4 } from '../create/export.js';

export const title = 'Hallencup-Logo';

const SETTINGS_KEY = 'svl.logo.settings';
const DEFAULT_SETTINGS = Object.freeze({
  edition: String(DEFAULTS.edition),
  title: DEFAULTS.title,
  subtitle: '',
  dateFrom: '2026-01-16',
  dateTo: '2026-01-18',
  dateFree: '',
  variant: 'gruen',
  stars: true,
  exportFormat: 'png', // 'png' | 'svg'
  exportSize: 1000,    // 500 | 1000 | 2000
  exportBg: 'transparent', // 'transparent' | 'white'
  animVariant: 'mid',      // 'lame' | 'mid' | 'exciting'
  animFormat: 'square',    // 'square' | 'story'
  animBg: 'gruen',         // 'gruen' | 'weiss' | 'dunkel'
});
const SIZES = [500, 1000, 2000];

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && typeof s === 'object') return { ...DEFAULT_SETTINGS, ...s };
  } catch { /* egal */ }
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* egal */ }
}

/** Einstellungen → Optionen für den Generator. */
function toLogoOptions(s) {
  return normalizeOptions({
    edition: s.edition,
    title: s.title,
    subtitle: s.subtitle,
    dateText: s.dateFree.trim() || formatDateRange(s.dateFrom, s.dateTo),
    stars: s.stars,
    variant: s.variant,
  });
}

/** Breite/Höhe aus viewBox der SVG lesen. */
function svgSize(svg) {
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
  return m ? { w: +m[3], h: +m[4] } : { w: 1, h: 1 };
}

const svgBlob = svg => new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', svg], { type: 'image/svg+xml' });

/** SVG-String als PNG rendern (Breite in px), optional weißer Hintergrund. */
async function renderPng(svg, width, { background = null, maxSide = null } = {}) {
  const { w, h } = svgSize(svg);
  let W = width, H = Math.round(width * h / w);
  if (maxSide && Math.max(W, H) > maxSide) { const k = maxSide / Math.max(W, H); W = Math.round(W * k); H = Math.round(H * k); }
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = await loadImage(url);
    try { await img.decode?.(); } catch { /* egal */ }
    // Safari lädt eingebettete Bilder in SVGs (Silber-Textur) teils verzögert
    await new Promise(r => setTimeout(r, 30));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, W, H); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);
    const blob = await canvasToBlob(canvas, 'image/png');
    return { blob, width: W, height: H };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let cleanup = null;

export async function mount(el) {
  useStyles('css/views/logo.css');
  const s = loadSettings();

  const chip = (group, value, label, extra = '') =>
    `<button type="button" class="chip" data-group="${group}" data-value="${value}" aria-pressed="false">${extra}${label}</button>`;

  const root = html`
    <div class="logo-view">
      <div class="stage logo-stage is-busy" aria-live="polite">
        <img alt="Vorschau des Hallencup-Logos" hidden>
        <div class="logo-loading"><span class="logo-spinner" aria-hidden="true"></span><span class="logo-loading-text">Laden …</span></div>
      </div>

      <section class="card">
        <p class="eyebrow">Schritt 1</p>
        <h2>Text im Banner</h2>
        <div class="row row-edition">
          <div class="field"><span id="logo-edition-label">Ausgabe</span>
            <div class="stepper">
              <button type="button" class="stepper-btn" data-step="-1" aria-label="Ausgabe verringern">−</button>
              <input type="number" name="edition" inputmode="numeric" min="1" max="999" placeholder="25" autocomplete="off" aria-labelledby="logo-edition-label">
              <button type="button" class="stepper-btn" data-step="1" aria-label="Ausgabe erhöhen">+</button>
            </div>
          </div>
          <label class="field"><span>Titel</span>
            <input type="text" name="title" placeholder="HALLENCUP" autocomplete="off" autocapitalize="characters" maxlength="40">
          </label>
        </div>
        <label class="field"><span>Zusatzzeile (optional)</span>
          <input type="text" name="subtitle" placeholder="z. B. Silber-Jubiläum" autocomplete="off" maxlength="40">
        </label>
      </section>

      <section class="card">
        <p class="eyebrow">Schritt 2</p>
        <h2>Turnier-Datum</h2>
        <div class="row row-even">
          <label class="field"><span>von</span><input type="date" name="dateFrom"></label>
          <label class="field"><span>bis</span><input type="date" name="dateTo"></label>
        </div>
        <p class="logo-hint">Im Logo steht: <strong data-date-preview></strong></p>
        <label class="field"><span>Datum als freier Text (optional)</span><small class="logo-hint-inline">Ersetzt „von/bis“, z. B. für „Januar 2027“.</small>
          <input type="text" name="dateFree" placeholder="z. B. 16.–18.01.2026" autocomplete="off" maxlength="40">
        </label>
      </section>

      <section class="card">
        <p class="eyebrow">Schritt 3</p>
        <h2>Gestaltung</h2>
        <span class="label" id="lbl-variant">Variante</span>
        <div class="chips" role="group" aria-labelledby="lbl-variant">
          ${chip('variant', 'gruen', 'Grün', '<span class="logo-swatch is-gruen" aria-hidden="true"></span>')}
          ${chip('variant', 'silber', 'Silber', '<span class="logo-swatch is-silber" aria-hidden="true"></span>')}
        </div>
        <label class="check" style="margin-top:12px"><input type="checkbox" name="stars"> Sterne anzeigen</label>
        <button type="button" class="btn btn-ghost btn-sm logo-reset" data-action="reset">Auf Vorlage 2026 zurücksetzen</button>
      </section>

      <section class="card">
        <p class="eyebrow">Schritt 4</p>
        <h2>Speichern &amp; Teilen</h2>
        <span class="label" id="lbl-format">Dateiformat</span>
        <div class="chips" role="group" aria-labelledby="lbl-format">
          ${chip('exportFormat', 'png', 'PNG (Bild)')}
          ${chip('exportFormat', 'svg', 'SVG (Vektor)')}
        </div>
        <div class="logo-export-opts" data-png-only>
          <span class="label" id="lbl-size" style="margin-top:14px">Breite</span>
          <div class="chips" role="group" aria-labelledby="lbl-size">
            ${SIZES.map(n => chip('exportSize', n, `${n} px`)).join('')}
          </div>
          <span class="label" id="lbl-bg" style="margin-top:14px">Hintergrund</span>
          <div class="chips" role="group" aria-labelledby="lbl-bg">
            ${chip('exportBg', 'transparent', 'Transparent')}
            ${chip('exportBg', 'white', 'Weiß')}
          </div>
        </div>
        <p class="logo-export-info" data-export-info></p>
        <div class="btn-row">
          <button type="button" class="btn" data-action="share" disabled>Teilen / Speichern</button>
          <button type="button" class="btn btn-secondary" data-action="archive" disabled>Ins Archiv</button>
        </div>
      </section>

      <section class="card logo-anim">
        <p class="eyebrow">Schritt 5</p>
        <h2>Als Video animieren</h2>
        <div class="stage logo-anim-stage">
          <canvas class="logo-anim-canvas" aria-label="Vorschau der Logo-Animation"></canvas>
          <button type="button" class="logo-anim-replay" data-action="anim-replay" aria-label="Animation neu starten">↻</button>
        </div>
        <span class="label" id="lbl-anim" style="margin-top:14px">Animation</span>
        <div class="chips" role="group" aria-labelledby="lbl-anim">
          ${Object.entries(VARIANTS).map(([k, v]) => chip('animVariant', k, v.label)).join('')}
        </div>
        <p class="logo-hint-inline" data-anim-hint style="margin-top:8px"></p>
        <span class="label" id="lbl-animfmt" style="margin-top:14px">Format</span>
        <div class="chips" role="group" aria-labelledby="lbl-animfmt">
          ${Object.entries(FORMATS).map(([k, v]) => chip('animFormat', k, v.label)).join('')}
        </div>
        <span class="label" id="lbl-animbg" style="margin-top:14px">Hintergrund</span>
        <div class="chips" role="group" aria-labelledby="lbl-animbg">
          ${Object.entries(BACKGROUNDS).map(([k, v]) => chip('animBg', k, v.label)).join('')}
        </div>
        <div class="logo-anim-progress" data-anim-progress hidden>
          <div class="progress"><div></div></div>
          <p class="logo-export-info">Video wird aufgenommen … bitte die App geöffnet lassen.</p>
          <button type="button" class="btn btn-ghost btn-sm" data-action="anim-cancel">Abbrechen</button>
        </div>
        <div class="btn-row" style="margin-top:16px" data-anim-actions>
          <button type="button" class="btn" data-action="anim-record">Video erstellen</button>
        </div>
        <div class="logo-anim-result" data-anim-result hidden>
          <video playsinline muted loop autoplay controls></video>
          <p class="logo-export-info" data-anim-info></p>
          <div class="btn-row">
            <button type="button" class="btn" data-action="anim-share">Teilen / Speichern</button>
            <button type="button" class="btn btn-secondary" data-action="anim-archive">Ins Archiv</button>
          </div>
        </div>
      </section>
    </div>
  `;
  el.append(root);

  const $ = sel => root.querySelector(sel);
  const stage = $('.logo-stage');
  const img = $('.logo-stage img');
  const loadingEl = $('.logo-loading');
  const loadingText = $('.logo-loading-text');
  const datePreview = $('[data-date-preview]');
  const exportInfo = $('[data-export-info]');
  const pngOnly = $('[data-png-only]');
  const btnShare = $('[data-action="share"]');
  const btnArchive = $('[data-action="archive"]');
  const inputs = ['edition', 'title', 'subtitle', 'dateFrom', 'dateTo', 'dateFree'].map(n => root.querySelector(`[name="${n}"]`));
  const starsInput = $('[name="stars"]');
  const animHint = $('[data-anim-hint]');

  // Plus/Minus neben der Ausgabe: Wert ändern und wie eine Eingabe behandeln.
  const editionInput = $('[name="edition"]');
  root.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
    const current = parseInt(editionInput.value, 10) || DEFAULTS.edition;
    editionInput.value = String(Math.min(999, Math.max(1, current + Number(btn.dataset.step))));
    editionInput.dispatchEvent(new Event('input', { bubbles: true }));
  }));

  let alive = true;
  let currentSvg = null;
  let currentOpts = null;
  let resources = null; // { fonts, silber? }
  let blobUrl = null;
  let renderTimer = 0, saveTimer = 0, publishTimer = 0, renderSeq = 0;
  let busy = false;

  function syncForm() {
    for (const inp of inputs) inp.value = s[inp.name] ?? '';
    starsInput.checked = !!s.stars;
    root.querySelectorAll('.chip[data-group]').forEach(c => {
      c.setAttribute('aria-pressed', String(String(s[c.dataset.group]) === c.dataset.value));
    });
    pngOnly.hidden = s.exportFormat !== 'png';
    animHint.textContent = VARIANTS[s.animVariant]?.hint || '';
    updateDatePreview();
    updateExportInfo();
  }

  function updateDatePreview() {
    const free = s.dateFree.trim();
    datePreview.textContent = free || formatDateRange(s.dateFrom, s.dateTo) || '– (kein Datum)';
  }

  function updateExportInfo() {
    if (s.exportFormat === 'svg') {
      exportInfo.textContent = 'Vektorgrafik – beliebig skalierbar, ideal für Druck und Weitergabe an Grafiker.';
      return;
    }
    let dims = '';
    if (currentSvg) { const { w, h } = svgSize(currentSvg); dims = ` × ${Math.round(s.exportSize * h / w)}`; }
    exportInfo.textContent = `PNG ${s.exportSize}${dims} px, ${s.exportBg === 'white' ? 'weißer' : 'transparenter'} Hintergrund.`;
  }

  function setBusy(on) {
    busy = on;
    btnShare.disabled = on || !currentSvg;
    btnArchive.disabled = on || !currentSvg;
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSettings(s), 250);
  }

  function scheduleRender(delay = 90) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  async function ensureResources(variant) {
    if (resources && (variant !== 'silber' || resources.silber)) return resources;
    if (variant === 'silber' && resources) loadingText.textContent = 'Silber-Variante wird geladen …';
    const res = await loadLogoResources({ variant });
    resources = { ...(resources || {}), ...res };
    return resources;
  }

  async function render() {
    clearTimeout(renderTimer); renderTimer = 0;
    const seq = ++renderSeq;
    const opts = toLogoOptions(s);
    stage.classList.add('is-busy');
    const needsLoad = !resources || (opts.variant === 'silber' && !resources.silber);
    if (needsLoad) { loadingEl.hidden = false; }
    try {
      const res = await ensureResources(opts.variant);
      if (!alive || seq !== renderSeq) return;
      const svg = buildHallencupSvg(opts, res);
      currentSvg = svg; currentOpts = opts;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(svgBlob(svg));
      img.src = blobUrl;
      img.hidden = false;
      loadingEl.hidden = true;
      stage.classList.remove('is-busy');
      updateExportInfo();
      setBusy(busy);
      anim.invalidate();
      // Für den Beitrags-Generator bereitstellen (gedrosselt, Silber-SVG ist groß)
      clearTimeout(publishTimer);
      publishTimer = setTimeout(() => setHallencupLogoSvg(svg), 500);
    } catch (err) {
      console.error(err);
      if (!alive || seq !== renderSeq) return;
      stage.classList.remove('is-busy');
      loadingEl.hidden = false;
      loadingEl.innerHTML = `<p><strong>Logo konnte nicht erzeugt werden.</strong><br><span class="small">${esc(err?.message || err)}</span></p><button type="button" class="btn btn-sm" data-action="retry">Erneut versuchen</button>`;
    }
  }

  // ---- Eingaben
  root.addEventListener('input', e => {
    const t = e.target;
    if (t === starsInput) { s.stars = t.checked; }
    else if (inputs.includes(t)) { s[t.name] = t.value; }
    else return;
    if (t.name?.startsWith('date')) updateDatePreview();
    persist();
    scheduleRender();
  });
  root.addEventListener('change', e => { if (e.target === starsInput) { s.stars = starsInput.checked; persist(); scheduleRender(0); } });

  root.addEventListener('click', async e => {
    const c = e.target.closest('.chip[data-group]');
    if (c) {
      const g = c.dataset.group;
      s[g] = g === 'exportSize' ? Number(c.dataset.value) : c.dataset.value;
      syncForm();
      persist();
      if (g === 'variant') scheduleRender(0);
      if (g === 'animFormat' || g === 'animBg') anim.invalidate(0);
      if (g.startsWith('anim')) anim.restart();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reset') {
      Object.assign(s, { ...DEFAULT_SETTINGS, exportFormat: s.exportFormat, exportSize: s.exportSize, exportBg: s.exportBg });
      syncForm(); persist(); scheduleRender(0);
      toast('Vorlage 2026 wiederhergestellt');
    } else if (action === 'retry') {
      loadingEl.innerHTML = '<span class="logo-spinner" aria-hidden="true"></span><span class="logo-loading-text">Laden …</span>';
      scheduleRender(0);
    } else if (action === 'share') {
      await doExport('share');
    } else if (action === 'archive') {
      await doExport('archive');
    } else if (action?.startsWith('anim-')) {
      await anim.action(action.slice(5));
    }
  });

  /** Aktuelle Exportdatei erzeugen. */
  async function makeExport() {
    // Ausstehende Eingaben zuerst übernehmen
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; await render(); }
    if (!currentSvg) throw new Error('Logo ist noch nicht fertig');
    const svg = currentSvg, opts = currentOpts;
    const year = (opts.dateText.match(/(\d{4})(?!.*\d{4})/) || [])[1] || '';
    const base = slug(['hallencup', opts.edition, opts.variant === 'silber' ? 'silber' : '', year].filter(Boolean).join(' '));
    const label = bannerText(opts) + (opts.subtitle ? ` – ${opts.subtitle}` : '');
    if (s.exportFormat === 'svg') {
      const blob = svgBlob(svg);
      const { w, h } = svgSize(svg);
      return { blob, filename: `${base}.svg`, format: 'logo-svg', formatLabel: 'Logo SVG (Vektor)', width: Math.round(w), height: Math.round(h), label, svg, opts };
    }
    const bg = s.exportBg === 'white' ? '#ffffff' : null;
    const { blob, width, height } = await renderPng(svg, s.exportSize, { background: bg });
    return {
      blob, filename: `${base}-${width}px${bg ? '-weiss' : ''}.png`, format: 'logo-png',
      formatLabel: `Logo PNG (${width}×${height}${bg ? ', weiß' : ', transparent'})`, width, height, label, svg, opts,
    };
  }

  async function doExport(kind) {
    if (busy) return;
    setBusy(true);
    const btn = kind === 'share' ? btnShare : btnArchive;
    const old = btn.textContent;
    btn.textContent = 'Bitte warten …';
    try {
      const out = await makeExport();
      if (kind === 'share') {
        const r = await shareOrDownload(out.blob, out.filename, { title: out.label });
        if (r === 'shared') toast('Geteilt');
        else if (r === 'downloaded') toast(`Gespeichert: ${out.filename}`);
      } else {
        const thumb = (await renderPng(out.svg, 400, { maxSide: 400 })).blob;
        try {
          const { saveItem } = await import('../storage.js');
          await saveItem({
            kind: 'logo', format: out.format, formatLabel: out.formatLabel, title: out.label,
            mime: out.blob.type, width: out.width, height: out.height, size: out.blob.size,
            blob: out.blob, thumb, meta: { ...s, dateText: out.opts.dateText },
          });
          toast('Im Archiv gespeichert');
        } catch (err) {
          console.error(err);
          toast(`Archiv: ${err?.message || 'Speichern fehlgeschlagen'}`, { error: true, ms: 4000 });
        }
      }
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Export fehlgeschlagen', { error: true, ms: 4000 });
    } finally {
      btn.textContent = old;
      if (alive) setBusy(false);
    }
  }

  // ---- Animation (Schritt 5)
  const anim = (() => {
    const canvas = $('.logo-anim-canvas');
    const ctx = canvas.getContext('2d');
    const progressBox = $('[data-anim-progress]');
    const progressBar = progressBox.querySelector('.progress > div');
    const actions = $('[data-anim-actions]');
    const btnRecord = $('[data-action="anim-record"]');
    const resultBox = $('[data-anim-result]');
    const video = resultBox.querySelector('video');
    const info = $('[data-anim-info]');
    let scene = null, sceneKey = '', building = null, timer = 0, raf = 0;
    let start = performance.now(), visible = true, recording = false, cancel = false;
    let result = null; // { blob, thumb, mime, url, filename, label, width, height, variant }

    if (!canRecordVideo()) {
      btnRecord.disabled = true;
      btnRecord.textContent = 'Video wird von diesem Browser nicht unterstützt';
    }

    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); }) : null;
    io?.observe(canvas);

    async function build() {
      if (!currentOpts || !resources) return;
      const F = FORMATS[s.animFormat] || FORMATS.square;
      const key = JSON.stringify([currentOpts, s.animFormat, s.animBg]);
      if (key === sceneKey && scene) return;
      const data = buildHallencupLayers(currentOpts, resources);
      const next = await prepareScene(data, { W: F.W, H: F.H, bg: s.animBg, scale: 0.4 });
      if (!alive) return;
      scene = next; sceneKey = key;
      canvas.width = scene.W; canvas.height = scene.H;
      canvas.style.aspectRatio = `${F.W} / ${F.H}`;
      canvas.classList.toggle('is-story', F.H > F.W);
      start = performance.now();
    }

    function invalidate(delay = 300) {
      clearTimeout(timer);
      timer = setTimeout(() => { building = build().catch(err => console.error(err)); }, delay);
      clearResult();
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      if (!scene || !visible || document.hidden) return;
      const V = VARIANTS[s.animVariant] || VARIANTS.mid;
      const t = ((performance.now() - start) / 1000) % (V.duration + 1.2);
      drawFrame(ctx, scene, s.animVariant, Math.min(t, V.duration));
    }
    raf = requestAnimationFrame(loop);

    function clearResult() {
      if (result?.url) URL.revokeObjectURL(result.url);
      result = null;
      video.removeAttribute('src'); video.load();
      resultBox.hidden = true;
    }

    function setRecording(on) {
      recording = on;
      progressBox.hidden = !on;
      actions.hidden = on;
      setBusy(on);
      root.querySelectorAll('.logo-anim .chip').forEach(c => { c.disabled = on; });
    }

    async function record() {
      if (recording) return;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; await render(); }
      if (!currentOpts) return;
      clearResult();
      cancel = false;
      setRecording(true);
      progressBar.style.width = '0%';
      const F = FORMATS[s.animFormat] || FORMATS.square;
      const variant = s.animVariant, opts = currentOpts;
      try {
        const full = await prepareScene(buildHallencupLayers(opts, resources), { W: F.W, H: F.H, bg: s.animBg });
        const out = await recordAnimation(full, variant, {
          onProgress: p => { progressBar.style.width = `${Math.round(p * 100)}%`; },
          isCancelled: () => cancel || !alive,
        });
        if (!alive) return;
        const ext = out.mime.includes('mp4') ? 'mp4' : 'webm';
        const year = (opts.dateText.match(/(\d{4})(?!.*\d{4})/) || [])[1] || '';
        const base = slug(['hallencup', opts.edition, year, 'animation', variant, s.animFormat === 'story' ? 'story' : ''].filter(Boolean).join(' '));
        result = {
          ...out, url: URL.createObjectURL(out.blob), filename: `${base}.${ext}`, variant,
          width: F.W, height: F.H, label: `${bannerText(opts)} – Animation „${variant}“`,
          formatLabel: `Logo-Animation „${variant}“ (${F.W}×${F.H})`,
        };
        video.src = result.url;
        video.play().catch(() => {});
        info.textContent = `${ext.toUpperCase()} · ${F.W}×${F.H} · ${(out.blob.size / 1024 / 1024).toFixed(1)} MB`
          + (ext === 'webm' ? ' – Hinweis: WhatsApp/Instagram bevorzugen MP4 (Safari/iPhone oder aktuelles Chrome erzeugen MP4).' : '');
        resultBox.hidden = false;
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        if (err?.name !== 'AbortError') { console.error(err); toast(err?.message || 'Video konnte nicht erstellt werden', { error: true, ms: 4000 }); }
      } finally {
        if (alive) setRecording(false);
      }
    }

    async function action(name) {
      if (name === 'replay') { start = performance.now(); return; }
      if (name === 'record') return record();
      if (name === 'cancel') { cancel = true; return; }
      if (!result) return;
      if (name === 'share') {
        const r = await shareOrDownload(result.blob, result.filename, { title: result.label });
        if (r === 'shared') toast('Geteilt');
        else if (r === 'downloaded') toast(`Gespeichert: ${result.filename}`);
      } else if (name === 'archive') {
        try {
          const { saveItem } = await import('../storage.js');
          await saveItem({
            kind: 'video', format: 'logo-anim', formatLabel: result.formatLabel, title: result.label,
            mime: result.mime, width: result.width, height: result.height, size: result.blob.size,
            blob: result.blob, thumb: result.thumb, meta: { ...s, dateText: currentOpts?.dateText },
          });
          toast('Im Archiv gespeichert');
        } catch (err) {
          console.error(err);
          toast(`Archiv: ${err?.message || 'Speichern fehlgeschlagen'}`, { error: true, ms: 4000 });
        }
      }
    }

    return {
      invalidate, action,
      restart: () => { start = performance.now(); },
      destroy: () => { cancel = true; cancelAnimationFrame(raf); clearTimeout(timer); io?.disconnect(); clearResult(); },
    };
  })();

  syncForm();
  setBusy(false);
  render();

  cleanup = () => {
    alive = false;
    clearTimeout(renderTimer);
    if (saveTimer) { clearTimeout(saveTimer); saveSettings(s); }
    if (publishTimer && currentSvg) { clearTimeout(publishTimer); setHallencupLogoSvg(currentSvg); }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    anim.destroy();
  };
}

export function unmount() {
  cleanup?.();
  cleanup = null;
}
