// Logo-Tab: Hallencup-Logo für die nächste Ausgabe anpassen und exportieren.
import { html, esc, toast, useStyles, canvasToBlob, shareOrDownload, slug, loadImage } from '../util.js';
import { setHallencupLogoSvg } from '../brand.js';
import { buildHallencupSvg, loadLogoResources, formatDateRange, bannerText, normalizeOptions, DEFAULTS } from '../hallencup-logo.js';

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
          <input type="text" name="dateFree" placeholder="z. B. 16.– 18.01.2026" autocomplete="off" maxlength="40">
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

  syncForm();
  setBusy(false);
  render();

  cleanup = () => {
    alive = false;
    clearTimeout(renderTimer);
    if (saveTimer) { clearTimeout(saveTimer); saveSettings(s); }
    if (publishTimer && currentSvg) { clearTimeout(publishTimer); setHallencupLogoSvg(currentSvg); }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
}

export function unmount() {
  cleanup?.();
  cleanup = null;
}
