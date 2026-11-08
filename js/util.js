// Gemeinsame Helfer für alle Views.

/** Kurze Meldung unten einblenden. */
export function toast(message, { error = false, ms = 2600 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('is-error', error);
  el.classList.add('is-visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-visible'), ms);
}

/** HTML-Template-String → DocumentFragment-freies Element (erstes Kind). */
export function html(strings, ...values) {
  const t = document.createElement('template');
  t.innerHTML = String.raw({ raw: strings }, ...values).trim();
  return t.content.firstElementChild;
}

/** Text für innerHTML entschärfen. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Canvas → Blob (Promise). */
export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), type, quality));
}

/** Blob als Datei herunterladen. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Kann das Gerät Dateien über das native Teilen-Menü teilen (WhatsApp, Instagram …)? */
export function canShareFiles(files) {
  try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
}

/**
 * Datei über das Teilen-Menü des Handys teilen; fällt auf Download zurück.
 * Gibt 'shared' | 'downloaded' | 'cancelled' zurück.
 */
export async function shareOrDownload(blob, filename, { title = 'SV Liegau', text = '' } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFiles([file])) {
    try { await navigator.share({ files: [file], title, text }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; console.warn(e); }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Datei-Dateiname-tauglich machen. */
export function slug(s) {
  return String(s || 'datei').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'datei';
}

/** Datum lesbar (z. B. 08.11.2026, 17:20). */
export function formatDate(ts) {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Bild aus URL/Blob laden. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src instanceof Blob ? URL.createObjectURL(src) : src;
  });
}

/** Bottom-Sheet-Dialog öffnen; gibt das <dialog> zurück. Schließt bei Klick auf Hintergrund. */
export function openSheet(title, bodyEl) {
  const dlg = html`<dialog class="sheet"><div class="sheet-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-sm" data-close>Schließen</button></div><div class="sheet-body"></div></dialog>`;
  dlg.querySelector('.sheet-body').append(bodyEl);
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** View-eigenes Stylesheet einmalig laden (z. B. useStyles('css/views/logo.css')). */
export function useStyles(href) {
  if (document.querySelector(`link[data-view-css="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.viewCss = href;
  document.head.append(l);
}
