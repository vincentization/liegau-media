// Archiv: alle gespeicherten Bilder, Videos und Logos.

import { html, esc, toast, formatDate, formatBytes, shareOrDownload, downloadBlob, openSheet, useStyles, slug } from '../util.js';
import {
  listItems, getItem, deleteItem, onChange, getStorageInfo, requestPersist,
  cloudConfigured, signIn, signOut, uploadLocalItems, countLocalOnly, extFor,
} from '../storage.js';

export const title = 'Archiv';

const FILTERS = [
  { id: 'all', label: 'Alle', test: () => true },
  { id: 'image', label: 'Bilder', test: i => i.kind === 'image' },
  { id: 'video', label: 'Videos', test: i => i.kind === 'video' },
  { id: 'logo', label: 'Logos', test: i => i.kind === 'logo' },
];

const SHORT = {
  'ig-story': 'IG Story', 'ig-post': 'IG Post', 'ig-square': 'IG Quadrat', 'ig-reel': 'IG Reel', 'wa-status': 'WA Status',
  'fb-post': 'FB Post', 'fb-story': 'FB Story', 'logo-png': 'Logo PNG', 'logo-svg': 'Logo SVG', 'logo-anim': 'Logo Video',
};
const badgeFor = i => SHORT[i.format] || (i.formatLabel || i.format || '').replace(/\s*\(.*\)\s*$/, '') || i.kind;

const fmtSize = n => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB' : formatBytes(n));

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

let state;

export async function mount(el) {
  useStyles('css/views/archive.css');
  state = { filter: 'all', query: '', items: [], urls: new Set(), el };

  el.innerHTML = '';
  el.append(html`
    <section class="archive">
      <div class="archive-head">
        <div>
          <p class="eyebrow">Gespeicherte Medien</p>
          <h1>Archiv <span class="archive-count" data-count></span></h1>
        </div>
      </div>
      <div data-login></div>
      <div class="chips archive-filters" role="group" aria-label="Filter">
        ${FILTERS.map(f => `<button type="button" class="chip" data-filter="${f.id}" aria-pressed="${f.id === 'all'}">${f.label}</button>`).join('')}
      </div>
      <input type="search" class="archive-search" placeholder="Titel suchen …" aria-label="Titel suchen" enterkeyhint="search">
      <div class="grid archive-grid" data-grid aria-live="polite"></div>
      <div data-empty></div>
      <button type="button" class="archive-status" data-status>
        <span data-status-text>…</span><span class="archive-status-link">Cloud-Archiv ›</span>
      </button>
    </section>`);

  el.querySelector('.archive-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    el.querySelectorAll('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    renderGrid();
  });
  el.querySelector('.archive-search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderGrid(); });
  el.querySelector('[data-grid]').addEventListener('click', e => {
    const card = e.target.closest('[data-id]');
    if (card) openDetail(state.items.find(i => i.id === card.dataset.id));
  });
  el.querySelector('[data-status]').addEventListener('click', openCloudSheet);

  state.off = onChange(() => refresh());
  requestPersist();
  await refresh();
}

export function unmount() {
  state?.off?.();
  revokeAll();
  state = null;
}

function revokeAll() {
  state?.urls.forEach(u => URL.revokeObjectURL(u));
  state?.urls.clear();
}

async function refresh() {
  const s = state;
  if (!s) return;
  const [items, info] = await Promise.all([
    listItems().catch(e => { console.error(e); toast('Archiv konnte nicht geladen werden', { error: true }); return []; }),
    getStorageInfo(),
  ]);
  if (s !== state) return; // View wurde inzwischen verlassen
  s.items = items;
  s.cloudUser = info.user;
  renderGrid();
  renderStatus(info);
}

function renderGrid() {
  const { el, items, filter, query } = state;
  const f = FILTERS.find(x => x.id === filter);
  const shown = items.filter(i => f.test(i) && (!query || (i.title || '').toLowerCase().includes(query) || badgeFor(i).toLowerCase().includes(query)));

  el.querySelector('[data-count]').textContent = items.length ? `(${items.length})` : '';
  el.querySelector('.archive-filters').classList.toggle('hidden', !items.length);
  el.querySelector('.archive-search').classList.toggle('hidden', !items.length);
  revokeAll();

  const grid = el.querySelector('[data-grid]');
  grid.innerHTML = shown.map(i => {
    let src = i.thumbUrl || '';
    if (i.thumb instanceof Blob) { src = URL.createObjectURL(i.thumb); state.urls.add(src); }
    const local = i.cloud === false && cloudConfigured && state.cloudUser;
    return `
      <button type="button" class="arch-item ${i.kind === 'logo' ? 'is-logo' : ''}" data-id="${esc(i.id)}">
        <span class="arch-thumb">
          ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : '<span class="arch-noimg">?</span>'}
          <span class="arch-badge">${esc(badgeFor(i))}</span>
          ${i.kind === 'video' ? `<span class="arch-play">${ICON_PLAY}</span>` : ''}
          ${local ? '<span class="arch-local" title="Nur auf diesem Gerät">lokal</span>' : ''}
        </span>
        <span class="arch-caption">
          <span class="arch-title">${esc(i.title || i.formatLabel || 'Ohne Titel')}</span>
          <span class="arch-date">${esc(formatDate(i.createdAt))}</span>
        </span>
      </button>`;
  }).join('');

  const empty = el.querySelector('[data-empty]');
  if (!items.length) {
    empty.innerHTML = `
      <div class="empty card archive-empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3z M5 8h14v12H5z M10 12h4" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <h2>Noch nichts gespeichert</h2>
        <p>Erstelle einen Beitrag oder ein Logo – alles, was du speicherst, landet hier.</p>
        <div class="btn-row">
          <a class="btn" href="#/create">Foto/Video posten</a>
          <a class="btn btn-secondary" href="#/logo">Logo bearbeiten</a>
        </div>
      </div>`;
  } else if (!shown.length) {
    empty.innerHTML = '<p class="empty">Keine Treffer für diesen Filter.</p>';
  } else {
    empty.innerHTML = '';
  }
}

function renderStatus(info) {
  const s = state;
  const total = s.items.reduce((n, i) => n + (i.size || 0), 0);
  s.el.querySelector('[data-status-text]').textContent = info.mode === 'cloud'
    ? `Cloud-Archiv · angemeldet als ${info.user}`
    : `Gespeichert auf diesem Gerät · ${formatBytes(total)}`;

  const login = s.el.querySelector('[data-login]');
  login.innerHTML = cloudConfigured && info.mode !== 'cloud' ? `
    <div class="card archive-login">
      <div>
        <p class="eyebrow">Gemeinsames Archiv</p>
        <p class="small">Melde dich mit dem Vereins-Login an, damit das ganze Team dieselben Medien sieht. Bis dahin wird nur auf diesem Gerät gespeichert.</p>
      </div>
      <button type="button" class="btn btn-sm" data-login-btn>Anmelden</button>
    </div>` : '';
  login.querySelector('[data-login-btn]')?.addEventListener('click', openCloudSheet);
}

/* ---------------- Detail-Ansicht ---------------- */

function fileName(item) {
  return `${slug(item.title || 'sv-liegau')}-${item.format || item.kind}.${extFor(item.mime)}`;
}

async function openDetail(meta) {
  if (!meta) return;
  const body = html`
    <div class="arch-detail">
      <div class="arch-preview ${meta.kind === 'logo' ? 'is-logo' : ''}" data-preview><div class="arch-loading">Lädt …</div></div>
      <dl class="arch-info">
        <dt>Format</dt><dd>${esc(meta.formatLabel || badgeFor(meta))}</dd>
        <dt>Größe</dt><dd>${meta.width && meta.height ? `${meta.width} × ${meta.height} px` : '–'}</dd>
        <dt>Datei</dt><dd>${esc(formatBytes(meta.size || 0))} · ${esc(extFor(meta.mime).toUpperCase())}</dd>
        <dt>Datum</dt><dd>${esc(formatDate(meta.createdAt))}</dd>
      </dl>
      <div class="btn-row" data-actions>
        <button type="button" class="btn" data-share disabled>Teilen</button>
        <button type="button" class="btn btn-secondary" data-download disabled>Herunterladen</button>
        <button type="button" class="btn btn-danger" data-delete>Löschen</button>
      </div>
      <div class="btn-row arch-confirm hidden" data-confirm>
        <p class="small">Wirklich löschen? Das kann nicht rückgängig gemacht werden${meta.cloud ? ' – auch für alle anderen im Team' : ''}.</p>
        <button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>
        <button type="button" class="btn btn-danger" data-really>Endgültig löschen</button>
      </div>
    </div>`;

  const dlg = openSheet(meta.title || 'Ohne Titel', body);
  let url = null;
  let item = null;
  dlg.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); });

  const q = s => body.querySelector(s);
  q('[data-share]').addEventListener('click', async () => {
    const r = await shareOrDownload(item.blob, fileName(item), { title: item.title || 'SV Liegau' });
    if (r === 'downloaded') toast('Gespeichert in „Downloads“');
  });
  q('[data-download]').addEventListener('click', () => { downloadBlob(item.blob, fileName(item)); toast('Download gestartet'); });
  q('[data-delete]').addEventListener('click', () => { q('[data-actions]').classList.add('hidden'); q('[data-confirm]').classList.remove('hidden'); });
  q('[data-cancel]').addEventListener('click', () => { q('[data-confirm]').classList.add('hidden'); q('[data-actions]').classList.remove('hidden'); });
  q('[data-really]').addEventListener('click', async e => {
    e.target.disabled = true;
    try { await deleteItem(meta.id); toast('Gelöscht'); dlg.close(); }
    catch (err) { console.error(err); toast(err.message || 'Löschen fehlgeschlagen', { error: true }); e.target.disabled = false; }
  });

  // Datei vorab laden – so funktioniert „Teilen“ auch auf iOS direkt beim Tippen.
  try {
    item = await getItem(meta.id);
    if (!item?.blob) throw new Error('Datei nicht gefunden');
  } catch (err) {
    console.error(err);
    q('[data-preview]').innerHTML = `<p class="arch-loading">${esc(err.message || 'Datei konnte nicht geladen werden')}</p>`;
    return;
  }
  if (!dlg.open) return;
  url = URL.createObjectURL(item.blob);
  q('[data-preview]').innerHTML = item.mime.startsWith('video/')
    ? `<video src="${url}" controls playsinline preload="metadata"></video>`
    : `<img src="${url}" alt="${esc(item.title || '')}">`;
  q('[data-share]').disabled = false;
  q('[data-download]').disabled = false;
}

/* ---------------- Cloud-Einstellungen ---------------- */

async function openCloudSheet() {
  const info = await getStorageInfo();
  const usage = info.quota ? `${fmtSize(info.usage)} von ${fmtSize(info.quota)} belegt` : '';
  let body;

  if (!cloudConfigured) {
    body = html`
      <div class="arch-cloud">
        <p><strong>Das Archiv ist auf diesem Gerät gespeichert.</strong> Es funktioniert offline, aber andere Geräte und Teammitglieder sehen deine Medien nicht.</p>
        <p class="small muted">${usage}${info.persisted ? ' · dauerhaft gespeichert' : ''}</p>
        <p class="small">Tipp: Wichtige Dateien zusätzlich über „Teilen“ oder „Herunterladen“ sichern – beim Löschen der Browserdaten geht das lokale Archiv verloren.</p>
        <h3>Gemeinsames Cloud-Archiv</h3>
        <p class="small">Ein Admin kann ein kostenloses, gemeinsames Archiv für das ganze Vereins-Team einrichten (Supabase). Danach meldet ihr euch hier mit einem gemeinsamen Vereins-Login an. Die Anleitung steht in der <code>README.md</code> des Projekts.</p>
      </div>`;
  } else if (info.user) {
    const pending = await countLocalOnly();
    body = html`
      <div class="arch-cloud">
        <p>Angemeldet als <strong>${esc(info.user)}</strong>. Neue Medien werden im gemeinsamen Cloud-Archiv gespeichert, das alle mit dem Vereins-Login sehen.</p>
        ${pending ? `<p class="small">${pending} Datei${pending > 1 ? 'en liegen' : ' liegt'} nur auf diesem Gerät.</p>
          <button type="button" class="btn btn-block" data-upload>Ins Cloud-Archiv hochladen</button>` : ''}
        <p class="small muted">Lokaler Cache: ${usage}</p>
        <button type="button" class="btn btn-ghost btn-block" data-logout>Abmelden</button>
      </div>`;
    body.querySelector('[data-logout]').addEventListener('click', async () => {
      await signOut(); toast('Abgemeldet'); dlg.close();
    });
    body.querySelector('[data-upload]')?.addEventListener('click', async e => {
      const b = e.target; b.disabled = true;
      try {
        const n = await uploadLocalItems((d, t) => { b.textContent = `Lade hoch … ${d}/${t}`; });
        toast(`${n} Datei${n === 1 ? '' : 'en'} hochgeladen`); dlg.close();
      } catch (err) { console.error(err); toast(err.message || 'Hochladen fehlgeschlagen', { error: true }); b.disabled = false; b.textContent = 'Erneut versuchen'; }
    });
  } else {
    body = html`
      <form class="arch-cloud" autocomplete="on">
        <p class="small">Mit dem gemeinsamen Vereins-Login anmelden. Zugangsdaten gibt es beim Admin.</p>
        <label class="field"><span>E-Mail</span><input type="email" name="email" autocomplete="username" required inputmode="email"></label>
        <label class="field"><span>Passwort</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit" class="btn btn-block">Anmelden</button>
        <p class="small muted">Ohne Anmeldung wird nur auf diesem Gerät gespeichert. ${usage}</p>
      </form>`;
    body.addEventListener('submit', async e => {
      e.preventDefault();
      const b = body.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Anmelden …';
      try {
        await signIn(body.email.value.trim(), body.password.value);
        toast('Angemeldet'); dlg.close();
      } catch (err) { toast(err.message || 'Anmeldung fehlgeschlagen', { error: true }); b.disabled = false; b.textContent = 'Anmelden'; }
    });
  }
  const dlg = openSheet('Cloud-Archiv', body);
}
