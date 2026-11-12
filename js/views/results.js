// Ergebnis- und Vorschau-Beiträge: Ergebnisse aller Mannschaften für einen Zeitraum – oder die
// kommenden Spiele (Anstoß, Ort) – von fussball.de, als Übersicht in drei Layouts oder ein
// einzelnes Spiel als Highlight mit Text.
import { toast, html, esc, slug, loadImage, useStyles, shareOrDownload, downloadBlob, openSheet, formatBytes } from '../util.js';
import { ensureFonts } from '../brand.js';
import { saveItem } from '../storage.js';
import { loadLogo } from '../create/logos.js';
import { exportImage } from '../create/export.js';
import {
  loadResults, mergeMatches, getEdits, setEdit, saveManual, deleteManual, newManualMatch,
  lastWeekend, lastDays, comingWeekend, nextDays, inRange, dateLabel, scoreText, isPlayed, outcome, OUTCOME_LABEL, teamLabel,
  shortDate, weekday, logoUrl, isoDate, upcomingMatches, kickoffText, isCancelled, venueShort,
} from '../results/data.js';
import { LAYOUTS, RESULT_FORMATS, drawResults, defaultHeadline } from '../results/render.js';

export const title = 'Ergebnisse';

const STORE_KEY = 'svl.results.settings';
const SEL_KEY = 'svl.results.selection'; // { excluded:[id], included:[id], highlights:[id] } – je Art eigener Schlüssel
const FOOTER_DEFAULT = 'Unsere Jugend ist unsere Zukunft!';
// Art des Beitrags: Ergebnisse (zurückliegend) oder Vorschau (kommende Spiele)
const KINDS = {
  results: { title: 'Ergebnisse', periods: { weekend: 'Letztes Wochenende', week: 'Letzte 7 Tage', custom: 'Eigener' }, textHint: 'z. B. Starke Leistung unserer B-Jugend – drei Tore in der ersten Halbzeit!' },
  preview: { title: 'Spieltag', periods: { weekend: 'Kommendes Wochenende', week: 'Nächste 7 Tage', custom: 'Eigener' }, textHint: 'z. B. Kommt vorbei und unterstützt unsere D-Jugend im Spitzenspiel!' },
};
const CLUB_PAGE = 'https://www.fussball.de/verein/sv-liegau-augustusbad-sachsen/-/id/00ES8GNBRC00007UVV0AG08LVUPGND5I';
const DEFAULTS = {
  kind: 'results',
  period: 'weekend', from: '', to: '',
  mode: 'overview', layout: 'paper', format: 'post',
  title: 'Ergebnisse', footer: FOOTER_DEFAULT,
  // Vorschau: eigene Werte (p…)
  pPeriod: 'weekend', pFrom: '', pTo: '',
  pTitle: KINDS.preview.title, pFooter: 'Kommt vorbei und feuert uns an!',
};

let S = null;

const isPv = () => S.settings.kind === 'preview';
/** Einstellung der aktuellen Art: 'title' → 'title' bzw. 'pTitle'. */
const K = k => (isPv() ? 'p' + k[0].toUpperCase() + k.slice(1) : k);
const selKey = kind => (kind === 'preview' ? SEL_KEY + '.preview' : SEL_KEY);

const readJson = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- Markup ----------
function template(st) {
  return html`
<div class="rs">
  <div class="rs-mode rs-kind" role="tablist" aria-label="Beitragsart">
    <button type="button" role="tab" data-kind="results">Ergebnisse</button>
    <button type="button" role="tab" data-kind="preview">Vorschau</button>
  </div>
  <div class="card">
    <div class="rs-step"><span>1</span><h2>Zeitraum</h2></div>
    <div class="rs-seg" role="group" aria-label="Zeitraum">
      <button type="button" class="chip" data-period="weekend"></button>
      <button type="button" class="chip" data-period="week"></button>
      <button type="button" class="chip" data-period="custom"></button>
    </div>
    <div class="row rs-custom" hidden>
      <label class="field"><span>Von</span><input type="date" data-in="from"></label>
      <label class="field"><span>Bis</span><input type="date" data-in="to"></label>
    </div>
    <p class="small muted rs-range" data-out="range"></p>
    <p class="small rs-status" data-out="status"></p>
  </div>

  <div class="card">
    <div class="rs-step"><span>2</span><h2>Spiele</h2><span class="rs-count small muted" data-out="count"></span></div>
    <p class="small muted rs-help">Haken = kommt ins Bild. <b class="rs-star-inline">${ICON_STAR}</b> = hervorheben. Stift = Spiel bearbeiten.</p>
    <ul class="rs-list" data-out="list"></ul>
    <button type="button" class="btn btn-ghost btn-block btn-sm" data-act="add">+ Spiel manuell hinzufügen</button>
  </div>

  <div class="card">
    <div class="rs-step"><span>3</span><h2>Gestalten</h2></div>
    <div class="rs-mode" role="tablist" aria-label="Art">
      <button type="button" role="tab" data-mode="overview">Übersicht</button>
      <button type="button" role="tab" data-mode="highlight">${ICON_STAR}Highlight</button>
    </div>

    <div data-when="overview">
      <span class="label">Layout</span>
      <div class="rs-layouts">
        ${LAYOUTS.map(l => `<button type="button" class="rs-layout" data-layout="${l.id}" aria-pressed="false"><canvas width="216" height="270"></canvas><b>${esc(l.label)}</b><small>${esc(l.hint)}</small></button>`).join('')}
      </div>
      <div class="row">
        <label class="field"><span>Überschrift</span><input type="text" data-in="title" maxlength="24" autocomplete="off"></label>
        <label class="field"><span>Fußzeile</span><input type="text" data-in="footer" maxlength="60" placeholder="leer = keine" autocomplete="off"></label>
      </div>
    </div>

    <div data-when="highlight" hidden>
      <label class="field"><span>Spiel</span><select data-in="hlMatch"></select></label>
      <label class="field"><span>Überschrift</span><input type="text" data-in="hlHeadline" maxlength="28" autocomplete="off"></label>
      <label class="field"><span>Kurzer Text <b class="rs-chars" data-out="chars"></b></span><textarea data-in="hlText" rows="3" maxlength="240"></textarea></label>
      <span class="label">Foto (optional)</span>
      <div class="rs-photo">
        <button type="button" class="btn btn-ghost btn-sm" data-act="photo">Foto wählen</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="nophoto" hidden>Foto entfernen</button>
        <input type="file" accept="image/*" class="rs-file" hidden>
      </div>
      <label class="cr-slider rs-photopos" hidden><span>Bildausschnitt</span><input type="range" data-in="photoY" min="-1" max="1" step="0.01" value="0"></label>
    </div>

    <span class="label">Format</span>
    <div class="rs-seg" role="group" aria-label="Format">
      ${RESULT_FORMATS.map(f => `<button type="button" class="chip" data-format="${f.id}">${esc(f.label)}</button>`).join('')}
    </div>
  </div>

  <div class="card rs-preview">
    <div class="rs-step"><span>4</span><h2>Vorschau &amp; Export</h2></div>
    <div class="stage rs-stage"><canvas class="rs-canvas" aria-label="Vorschau"></canvas></div>
    <button type="button" class="btn btn-block rs-go" data-act="export">Bild erstellen</button>
    <div class="rs-results"></div>
  </div>
</div>`;
}

// ---------- Mount ----------
export async function mount(el) {
  useStyles('css/views/create.css'); // Slider-Stile
  useStyles('css/views/results.css');
  const settings = { ...DEFAULTS, ...readJson(STORE_KEY, {}) };
  const root = template(settings);
  S = {
    root, settings,
    excluded: new Set(), included: new Set(), highlights: new Set(),
    data: { generatedAt: null, error: null, matches: [] },
    all: [],
    upcoming: [],
    hl: { matchId: '', headline: '', text: '', photo: null, photoY: 0, photoUrl: null },
    images: { club: null, logos: new Map() },
    loading: new Set(),
    results: [],
    urls: new Set(),
    raf: 0,
  };
  loadSelection();
  el.append(root);
  S.$ = s => root.querySelector(s);
  S.canvas = S.$('.rs-canvas');
  bind();
  syncControls();
  S.$('[data-out="status"]').textContent = 'Lade Ergebnisse …';

  ensureFonts().then(() => S && redraw());
  loadLogo('club').then(img => { if (S) { S.images.club = img; redraw(); } }).catch(e => console.warn(e));

  S.data = await loadResults();
  if (!S) return;
  refresh();
}

export function unmount() {
  if (!S) return;
  cancelAnimationFrame(S.raf);
  clearTimeout(S.rafT);
  S.urls.forEach(u => URL.revokeObjectURL(u));
  if (S.hl.photoUrl) URL.revokeObjectURL(S.hl.photoUrl);
  S = null;
}

// ---------- Zustand ----------
function saveSettings() { writeJson(STORE_KEY, S.settings); }
function saveSelection() { writeJson(selKey(S.settings.kind), { excluded: [...S.excluded], included: [...S.included], highlights: [...S.highlights] }); }
function loadSelection() {
  const sel = readJson(selKey(S.settings.kind), {});
  S.excluded = new Set(sel.excluded || []);
  S.included = new Set(sel.included || []);
  S.highlights = new Set(sel.highlights || []);
}

const defaultPeriod = () => (isPv() ? comingWeekend() : lastWeekend());
function period() {
  const st = S.settings;
  const kind = st[K('period')], from = st[K('from')], to = st[K('to')];
  if (kind === 'week') return isPv() ? nextDays(7) : lastDays(7);
  if (kind === 'custom' && from && to) return from <= to ? { from, to } : { from: to, to: from };
  return defaultPeriod();
}

/** Ergebnisse: alle Spiele. Vorschau: nur anstehende, verlegte am neuen Termin. */
const baseList = () => (isPv() ? S.upcoming : S.all);
function periodMatches() { return baseList().filter(m => inRange(m, period())); }
/** Standard: Ergebnisse → Spiele mit Ergebnis ausgewählt; Vorschau → alle außer abgesetzten. */
const defaultOn = m => (isPv() ? !isCancelled(m) : isPlayed(m));
const isSelected = m => (defaultOn(m) ? !S.excluded.has(m.id) : S.included.has(m.id));
function selectedMatches() { return periodMatches().filter(isSelected); }
/** Ergebnis bzw. Anstoß für Liste und Auswahl. */
const midText = m => (isPv() ? kickoffText(m) : scoreText(m));

function refresh() {
  S.all = mergeMatches(S.data.matches);
  S.upcoming = upcomingMatches(S.all);
  renderStatus();
  renderList();
  renderHlSelect();
  loadTeamLogos();
  redraw();
}

// ---------- UI-Sync ----------
function syncControls() {
  const st = S.settings, $ = S.$;
  const kind = KINDS[st.kind] || KINDS.results;
  S.root.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.kind === st.kind)));
  S.root.querySelectorAll('[data-period]').forEach(b => {
    b.textContent = kind.periods[b.dataset.period];
    b.setAttribute('aria-pressed', String(b.dataset.period === st[K('period')]));
  });
  $('.rs-custom').hidden = st[K('period')] !== 'custom';
  if (st[K('period')] === 'custom') {
    const p = period();
    $('[data-in="from"]').value = st[K('from')] || p.from;
    $('[data-in="to"]').value = st[K('to')] || p.to;
  }
  const title = $('[data-in="title"]'), footer = $('[data-in="footer"]');
  if (document.activeElement !== title) title.value = st[K('title')];
  if (document.activeElement !== footer) footer.value = st[K('footer')];
  title.placeholder = kind.title;
  $('[data-in="hlText"]').placeholder = kind.textHint;
  S.root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === st.mode)));
  S.root.querySelectorAll('[data-when]').forEach(n => { n.hidden = n.dataset.when !== st.mode; });
  S.root.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === st.layout)));
  S.root.querySelectorAll('[data-format]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === st.format)));
  const p = period();
  const fmt = d => `${weekday(d)} ${shortDate(d)}`;
  $('[data-out="range"]').textContent = `${fmt(p.from)} bis ${fmt(p.to)}`;
  $('.rs-go').textContent = st.mode === 'highlight' ? (isPv() ? 'Ankündigung erstellen' : 'Highlight-Bild erstellen') : 'Bild erstellen';
}

function renderStatus() {
  const { generatedAt, error } = S.data;
  const out = S.$('[data-out="status"]');
  const stand = generatedAt ? new Date(generatedAt).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  out.classList.toggle('is-error', !!error);
  out.innerHTML = error
    ? `⚠︎ Ergebnisse konnten nicht geladen werden (${esc(error)}). Spiele lassen sich unten manuell eintragen. <a href="${CLUB_PAGE}" target="_blank" rel="noopener">fussball.de öffnen</a>`
    : `Stand fussball.de: <b>${esc(stand || '–')}</b> · <a href="${CLUB_PAGE}" target="_blank" rel="noopener">Vereinsseite</a>`;
}

function matchRow(m) {
  const sel = isSelected(m), star = S.highlights.has(m.id);
  const pv = isPv();
  const played = pv ? !isCancelled(m) && !!m.time : isPlayed(m);
  const oc = pv ? null : outcome(m);
  const sc = midText(m) || 'offen';
  const place = pv ? venueShort(m) : '';
  return `
  <li class="rs-item${sel ? ' is-on' : ''}${star ? ' is-star' : ''}" data-id="${esc(m.id)}">
    <label class="rs-check"><input type="checkbox" data-op="toggle"${sel ? ' checked' : ''} aria-label="Ins Bild übernehmen"></label>
    <div class="rs-body">
      <span class="rs-meta">${esc(weekday(m.date))} ${esc(shortDate(m.date))}${m.time ? ' · ' + esc(m.time) : ''} · <b>${esc(teamLabel(m))}</b>${m.competition ? ' · ' + esc(m.competition) : ''}${m.movedFrom ? ' · <i>verlegt vom ' + esc(shortDate(m.movedFrom)) + '</i>' : ''}${m.edited ? ' · <i>korrigiert</i>' : ''}${m.manual ? ' · <i>manuell</i>' : ''}</span>
      <span class="rs-teams"><span class="${m.home.own ? 'own' : ''}">${esc(m.home.name)}</span> – <span class="${m.away.own ? 'own' : ''}">${esc(m.away.name || '?')}</span></span>
      ${place ? `<span class="rs-venue">${esc(place)}</span>` : ''}
    </div>
    <span class="rs-score${played ? '' : ' is-open'}${pv && played ? ' is-time' : ''}${oc ? ' is-' + oc : ''}" title="${oc ? OUTCOME_LABEL[oc] : pv && played ? 'Anstoß' : ''}">${esc(sc)}</span>
    <button type="button" class="rs-icon rs-star" data-op="star" aria-pressed="${star}" aria-label="Hervorheben">${ICON_STAR}</button>
    <button type="button" class="rs-icon" data-op="edit" aria-label="Bearbeiten">${ICON_EDIT}</button>
  </li>`;
}

function renderList() {
  const list = periodMatches();
  const box = S.$('[data-out="list"]');
  box.innerHTML = list.length ? list.map(matchRow).join('') : `<li class="rs-empty small muted">${S.data.error ? 'Keine Daten.' : isPv() ? 'Keine anstehenden Spiele in diesem Zeitraum.' : 'Keine Spiele in diesem Zeitraum.'}</li>`;
  const n = selectedMatches().length;
  S.$('[data-out="count"]').textContent = list.length ? `${n} von ${list.length} im Bild` : '';
}

function renderHlSelect() {
  const sel = S.$('[data-in="hlMatch"]');
  const pv = isPv();
  const list = periodMatches().filter(pv ? m => !isCancelled(m) : isPlayed);
  if (!list.some(m => m.id === S.hl.matchId)) {
    const nice = pv ? m => m.home.own && !m.away.own : m => outcome(m) === 'win';
    S.hl.matchId = (list.find(m => S.highlights.has(m.id)) || list.find(nice) || list[0])?.id || '';
    S.hl.headline = '';
  }
  const opt = m => pv
    ? `${weekday(m.date)} ${shortDate(m.date)} ${m.time || ''} · ${teamLabel(m)}: ${m.home.name} – ${m.away.name}`
    : `${teamLabel(m)}: ${m.home.name} – ${m.away.name} ${scoreText(m)}`;
  sel.innerHTML = list.length
    ? list.map(m => `<option value="${esc(m.id)}"${m.id === S.hl.matchId ? ' selected' : ''}>${S.highlights.has(m.id) ? '★ ' : ''}${esc(opt(m))}</option>`).join('')
    : `<option value="">${pv ? 'Keine anstehenden Spiele im Zeitraum' : 'Keine Spiele mit Ergebnis im Zeitraum'}</option>`;
  const hm = hlMatch();
  const head = S.$('[data-in="hlHeadline"]');
  head.placeholder = defaultHeadline(hm, S.settings.kind) || 'Überschrift';
  head.value = S.hl.headline;
  S.$('[data-in="hlText"]').value = S.hl.text;
  updateChars();
}
const hlMatch = () => baseList().find(m => m.id === S.hl.matchId) || null;
function updateChars() { S.$('[data-out="chars"]').textContent = `${S.hl.text.length}/240`; }

// ---------- Logos ----------
function loadTeamLogos() {
  const ids = new Set(periodMatches().flatMap(m => [m.home, m.away]).filter(t => !t.own && t.logo).map(t => t.logo));
  for (const id of ids) {
    if (S.images.logos.has(id) || S.loading.has(id)) continue;
    S.loading.add(id);
    loadImage(logoUrl(id)).then(img => { S?.images.logos.set(id, img); }).catch(() => { S?.images.logos.set(id, null); })
      .finally(() => { if (S) { S.loading.delete(id); redraw(); } });
  }
}

// ---------- Zeichnen ----------
function sceneFor(fmt, layout = S.settings.mode === 'highlight' ? 'highlight' : S.settings.layout) {
  const matches = selectedMatches();
  const st = S.settings;
  return {
    kind: st.kind, layout, W: fmt.w, H: fmt.h, story: fmt.story,
    matches, highlights: S.highlights,
    title: st[K('title')].trim() || KINDS[st.kind].title,
    dateText: dateLabel(matches),
    footer: st[K('footer')].trim(),
    images: S.images,
    hl: { match: hlMatch(), headline: S.hl.headline.trim() || defaultHeadline(hlMatch(), st.kind), text: S.hl.text.trim(), photo: S.hl.photo, photoY: S.hl.photoY },
  };
}
const currentFormat = () => RESULT_FORMATS.find(f => f.id === S.settings.format) || RESULT_FORMATS[0];

function redraw() {
  if (!S) return;
  cancelAnimationFrame(S.raf);
  clearTimeout(S.rafT);
  const run = () => {
    cancelAnimationFrame(S?.raf); clearTimeout(S?.rafT);
    if (!S) return;
    const fmt = currentFormat();
    // Vorschau in halber Auflösung (schnell, scharf genug)
    const k = 0.5;
    const c = S.canvas;
    if (c.width !== fmt.w * k || c.height !== fmt.h * k) { c.width = fmt.w * k; c.height = fmt.h * k; }
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawResults(ctx, sceneFor(fmt));
    if (S.settings.mode === 'overview') drawThumbs();
  };
  // rAF bündelt Änderungen; Timer als Rückfall, falls rAF pausiert (Hintergrund-Tab)
  S.raf = requestAnimationFrame(run);
  S.rafT = setTimeout(run, 150);
}

function drawThumbs() {
  const fmt = RESULT_FORMATS[0];
  S.root.querySelectorAll('.rs-layout').forEach(btn => {
    const c = btn.querySelector('canvas');
    const k = c.width / fmt.w;
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawResults(ctx, sceneFor(fmt, btn.dataset.layout));
  });
}

// ---------- Events ----------
function bind() {
  const root = S.root, st = S.settings;
  root.addEventListener('click', e => {
    const t = e.target.closest('button, input[type="checkbox"]');
    if (!t) return;
    if (t.dataset.kind) {
      if (t.dataset.kind === st.kind) return;
      st.kind = t.dataset.kind;
      loadSelection();
      S.hl.matchId = ''; S.hl.headline = '';
      saveSettings(); syncControls(); renderList(); renderHlSelect(); loadTeamLogos(); redraw();
      return;
    }
    if (t.dataset.period) {
      st[K('period')] = t.dataset.period;
      if (t.dataset.period === 'custom' && !st[K('from')]) { const p = defaultPeriod(); st[K('from')] = p.from; st[K('to')] = p.to; }
      saveSettings(); syncControls(); renderList(); renderHlSelect(); loadTeamLogos(); redraw();
      return;
    }
    if (t.dataset.mode) { st.mode = t.dataset.mode; saveSettings(); syncControls(); redraw(); return; }
    if (t.dataset.layout) { st.layout = t.dataset.layout; saveSettings(); syncControls(); redraw(); return; }
    if (t.dataset.format) { st.format = t.dataset.format; saveSettings(); syncControls(); redraw(); return; }
    const op = t.dataset.op;
    if (op) {
      const id = t.closest('[data-id]')?.dataset.id;
      const m = baseList().find(x => x.id === id);
      if (!m) return;
      if (op === 'toggle') {
        const on = t.checked;
        if (defaultOn(m)) { if (on) S.excluded.delete(id); else S.excluded.add(id); }
        else { if (on) S.included.add(id); else S.included.delete(id); }
      } else if (op === 'star') {
        if (S.highlights.has(id)) S.highlights.delete(id);
        else {
          S.highlights.add(id);
          // Hervorgehobenes Spiel gehört ins Bild
          if (defaultOn(m)) S.excluded.delete(id); else S.included.add(id);
        }
      } else if (op === 'edit') { editMatch(m); return; }
      saveSelection(); renderList(); renderHlSelect(); redraw();
      return;
    }
    const act = t.dataset.act;
    if (act === 'add') editMatch(newManualMatch(isPv() ? period().from : period().to), true);
    else if (act === 'photo') S.$('.rs-file').click();
    else if (act === 'nophoto') setPhoto(null);
    else if (act === 'export') doExport();
    else if (act && t.dataset.result != null) resultAction(t);
  });

  root.addEventListener('input', e => {
    const k = e.target.dataset.in;
    if (!k) return;
    const v = e.target.value;
    if (k === 'title' || k === 'footer') { st[K(k)] = v; saveSettings(); }
    else if (k === 'from' || k === 'to') {
      if (!v) return;
      st[K(k)] = v; saveSettings(); syncControls(); renderList(); renderHlSelect(); loadTeamLogos();
    }
    else if (k === 'hlMatch') { S.hl.matchId = v; S.hl.headline = ''; renderHlSelect(); }
    else if (k === 'hlHeadline') S.hl.headline = v;
    else if (k === 'hlText') { S.hl.text = v; updateChars(); }
    else if (k === 'photoY') S.hl.photoY = +v;
    redraw();
  });

  S.$('.rs-file').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPhoto(f);
  });
}

async function setPhoto(file) {
  if (S.hl.photoUrl) { URL.revokeObjectURL(S.hl.photoUrl); S.hl.photoUrl = null; }
  S.hl.photo = null;
  if (file) {
    try {
      S.hl.photoUrl = URL.createObjectURL(file);
      S.hl.photo = await loadImage(S.hl.photoUrl);
    } catch { toast('Foto konnte nicht geladen werden', { error: true }); }
  }
  if (!S) return;
  S.$('[data-act="nophoto"]').hidden = !S.hl.photo;
  S.$('.rs-photopos').hidden = !S.hl.photo;
  S.$('[data-act="photo"]').textContent = S.hl.photo ? 'Anderes Foto' : 'Foto wählen';
  redraw();
}

// ---------- Bearbeiten ----------
function editMatch(m, isNew = false) {
  const own = m.away.own && !m.home.own ? 'away' : 'home';
  const body = html`
    <form class="rs-edit">
      <div class="row">
        <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(m.date)}" required></label>
        <label class="field"><span>Anstoß</span><input type="time" name="time" value="${esc(m.time || '')}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Altersklasse</span><input type="text" name="ageGroup" value="${esc(m.ageGroup)}" placeholder="z. B. D-Junioren" list="rs-ages"></label>
      </div>
      <datalist id="rs-ages">${['Herren', 'Alte Herren', 'A-Junioren', 'B-Junioren', 'C-Junioren', 'D-Junioren', 'E-Junioren', 'F-Junioren', 'G-Junioren', 'Frauen'].map(a => `<option value="${a}">`).join('')}</datalist>
      <label class="field"><span>Wettbewerb</span><input type="text" name="competition" value="${esc(m.competition)}" placeholder="z. B. 1.Kreisliga (A)"></label>
      <label class="field"><span>Heim</span><input type="text" name="home" value="${esc(m.home.name)}" required></label>
      <label class="field"><span>Gast</span><input type="text" name="away" value="${esc(m.away.name)}" required></label>
      <span class="label">Unsere Mannschaft ist</span>
      <div class="rs-seg rs-own">
        <label class="chip"><input type="radio" name="own" value="home"${own === 'home' ? ' checked' : ''}> Heim</label>
        <label class="chip"><input type="radio" name="own" value="away"${own === 'away' ? ' checked' : ''}> Gast</label>
      </div>
      <div class="row rs-goals">
        <label class="field"><span>Tore Heim</span><input type="number" name="h" min="0" max="99" inputmode="numeric" value="${m.score ? m.score[0] : ''}"></label>
        <label class="field"><span>Tore Gast</span><input type="number" name="a" min="0" max="99" inputmode="numeric" value="${m.score ? m.score[1] : ''}"></label>
      </div>
      <label class="field"><span>Oder Status (statt Toren)</span><input type="text" name="status" value="${esc(m.score ? '' : m.status)}" placeholder="z. B. o.E., Nichtantritt GAST" list="rs-status"></label>
      <datalist id="rs-status"><option value="o.E."><option value="Nichtantritt GAST"><option value="Nichtantritt HEIM"><option value="Absetzung"><option value="Ausfall"></datalist>
      <div class="btn-row">
        <button type="submit" class="btn">Übernehmen</button>
        ${isNew ? '' : m.manual ? '<button type="button" class="btn btn-danger" data-x="delete">Löschen</button>' : (getEdits()[m.id] ? '<button type="button" class="btn btn-ghost" data-x="reset">fussball.de-Stand</button>' : '')}
      </div>
    </form>`;
  const dlg = openSheet(isNew ? 'Spiel hinzufügen' : 'Spiel bearbeiten', body);
  body.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(body);
    const h = f.get('h'), a = f.get('a');
    const ownSide = f.get('own');
    const score = h !== '' && a !== '' ? [Math.max(0, +h), Math.max(0, +a)] : null;
    const patch = {
      date: f.get('date') || m.date,
      time: String(f.get('time') || ''),
      ageGroup: String(f.get('ageGroup') || '').trim(),
      competition: String(f.get('competition') || '').trim(),
      home: { name: String(f.get('home')).trim(), own: ownSide === 'home' },
      away: { name: String(f.get('away')).trim(), own: ownSide === 'away' },
      score,
      status: score ? '' : String(f.get('status') || '').trim(),
    };
    if (m.manual) {
      saveManual({ ...m, ...patch, home: { ...m.home, ...patch.home }, away: { ...m.away, ...patch.away } });
      if (isNew) S.included.add(m.id);
    } else {
      setEdit(m.id, patch);
    }
    if (isNew && (score || isPv())) S.excluded.delete(m.id);
    saveSelection();
    dlg.close();
    refresh();
    toast(isNew ? 'Spiel hinzugefügt' : 'Gespeichert');
  });
  body.addEventListener('click', e => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'delete') { deleteManual(m.id); dlg.close(); refresh(); toast('Spiel gelöscht'); }
    if (x === 'reset') { setEdit(m.id, null); dlg.close(); refresh(); toast('fussball.de-Stand wiederhergestellt'); }
  });
}

// ---------- Export ----------
async function doExport() {
  const fmt = currentFormat();
  const st = S.settings;
  const isHl = st.mode === 'highlight';
  if (isHl && !hlMatch()) { toast('Bitte ein Spiel wählen', { error: true }); return; }
  if (!isHl && !selectedMatches().length) { toast('Keine Spiele ausgewählt', { error: true }); return; }
  const btn = S.$('.rs-go');
  btn.disabled = true;
  try {
    await ensureFonts();
    const scene = sceneFor(fmt);
    const out = await exportImage(fmt.w, fmt.h, ctx => drawResults(ctx, scene));
    if (!S) return;
    const m = hlMatch();
    const pv = isPv();
    const name = isHl
      ? `${pv ? 'ankuendigung' : 'highlight'}_${teamLabel(m)}_${m.date}`
      : `${pv ? 'vorschau' : 'ergebnisse'}_${scene.dateText || isoDate(new Date())}_${st.layout}`;
    const filename = `sv-liegau_${slug(name)}_${fmt.id}.jpg`;
    const titleText = isHl
      ? (pv ? `Ankündigung: ${teamLabel(m)} ${weekday(m.date)} ${shortDate(m.date)} ${m.time || ''}`.trim() : `Highlight: ${teamLabel(m)} ${scoreText(m)}`)
      : `${pv ? 'Vorschau' : 'Ergebnisse'} ${scene.dateText}`;
    const url = URL.createObjectURL(out.blob); S.urls.add(url);
    S.results.unshift({ ...out, fmt, filename, url, title: titleText });
    renderResults();
    let archived = true;
    try {
      await saveItem({
        kind: 'image', format: fmt.formatId, formatLabel: fmt.formatLabel, title: titleText,
        mime: out.mime, width: fmt.w, height: fmt.h, size: out.blob.size, blob: out.blob, thumb: out.thumb,
        meta: { results: { kind: st.kind, mode: st.mode, layout: st.layout, matches: scene.matches.map(x => x.id), highlights: [...S.highlights] } },
      });
    } catch (e) { console.warn('Archiv:', e); archived = false; }
    toast(archived ? 'Bild erstellt und im Archiv gespeichert' : 'Bild erstellt (Archiv nicht verfügbar)');
    S.$('.rs-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    console.error(e);
    toast('Fehler beim Erstellen: ' + (e?.message || e), { error: true, ms: 5000 });
  } finally {
    if (S) btn.disabled = false;
  }
}

function renderResults() {
  const box = S.$('.rs-results');
  box.innerHTML = S.results.length ? `
    <h3>Fertig zum Teilen</h3>
    <ul class="rs-out">
      ${S.results.map((r, i) => `
      <li>
        <button type="button" class="rs-thumb" data-act="view" data-result="${i}" aria-label="Ansehen"><img src="${r.url}" alt="" style="aspect-ratio:${r.fmt.w}/${r.fmt.h}"></button>
        <div>
          <strong>${esc(r.title)}</strong>
          <span class="small muted">${esc(r.fmt.label)} · ${formatBytes(r.blob.size)}</span>
          <div class="btn-row">
            <button type="button" class="btn btn-blue btn-sm" data-act="share" data-result="${i}">${ICON_SHARE}Teilen</button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="save" data-result="${i}">${ICON_SAVE}Speichern</button>
          </div>
        </div>
      </li>`).join('')}
    </ul>` : '';
}

async function resultAction(btn) {
  const r = S.results[+btn.dataset.result];
  if (!r) return;
  const act = btn.dataset.act;
  if (act === 'save') downloadBlob(r.blob, r.filename);
  else if (act === 'share') {
    const how = await shareOrDownload(r.blob, r.filename, { title: 'SV Liegau' });
    if (how === 'downloaded') toast('Datei gespeichert');
  } else if (act === 'view') openSheet(r.title, html`<img class="rs-sheet-img" src="${r.url}" alt="">`);
}
