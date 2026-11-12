// Spielergebnisse: Laden (data/results.json, vom Workflow erzeugt), lokale Korrekturen,
// manuell ergänzte Spiele, Zeiträume und Anzeige-Helfer.
import { uid } from '../util.js';

const DATA_URL = 'data/results.json';
const EDITS_KEY = 'svl.results.edits';     // { [matchId]: Partial<Match> }
const MANUAL_KEY = 'svl.results.manual';   // Match[]

/**
 * Match = {
 *   id, date:'YYYY-MM-DD', time:'HH:MM', ageGroup:'B-Junioren', competition:'1.Kreisliga (A)',
 *   home:{ name, logo, own }, away:{ name, logo, own },   // logo = fussball.de-Logo-ID (data/logos/<id>.png)
 *   venue:'Kunstrasenplatz, SpA Liegau-Aug. Kunstrasen, Zum Sportplatz 14, 01454 Radeberg',
 *   score:[h,a] | null, status:'' | 'o.E.' | 'Absetzung' | '22.11.2026 11:00' (neuer Termin) | …, note, url, manual?
 * }
 */

export async function loadResults() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Noch keine Daten (data/results.json fehlt)' : `HTTP ${res.status}`);
    const data = await res.json();
    return { generatedAt: data.generatedAt || null, error: data.error || null, matches: data.matches || [] };
  } catch (e) {
    return { generatedAt: null, error: e.message || String(e), matches: [] };
  }
}

const readJson = (key, fb) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } };
const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* voll/privat */ } };

export const getEdits = () => readJson(EDITS_KEY, {});
export function setEdit(id, patch) {
  const all = getEdits();
  if (patch) all[id] = patch; else delete all[id];
  writeJson(EDITS_KEY, all);
}
export const getManual = () => readJson(MANUAL_KEY, []);
export function saveManual(match) {
  const all = getManual().filter(m => m.id !== match.id);
  all.push(match);
  writeJson(MANUAL_KEY, all);
}
export function deleteManual(id) { writeJson(MANUAL_KEY, getManual().filter(m => m.id !== id)); }

export function newManualMatch(date) {
  return {
    id: 'manual-' + uid(), manual: true, date, time: '', ageGroup: '', competition: '',
    home: { name: 'SV Liegau-Augustusbad', logo: '', own: true },
    away: { name: '', logo: '', own: false },
    score: null, status: '', note: '', url: '',
  };
}

/** Daten + Korrekturen + manuelle Spiele zusammenführen, chronologisch. */
export function mergeMatches(fetched) {
  const edits = getEdits();
  const list = [...fetched, ...getManual()].map(m => {
    const e = edits[m.id];
    if (!e) return m;
    return { ...m, ...e, home: { ...m.home, ...(e.home || {}) }, away: { ...m.away, ...(e.away || {}) }, edited: true };
  });
  return list.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

// ---------- Zeiträume ----------
const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Letztes Wochenende (Fr–So). Am Samstag/Sonntag ist das laufende Wochenende gemeint,
 * Mo–Fr das zurückliegende. Freitag zählt mit (Herren spielen manchmal freitags).
 */
export function lastWeekend(today = new Date()) {
  const dow = today.getDay(); // 0 So … 6 Sa
  const sat = addDays(today, dow === 6 ? 0 : dow === 0 ? -1 : -(dow + 1));
  return { from: isoDate(addDays(sat, -1)), to: isoDate(addDays(sat, 1)) };
}
export function nextWeekend(today = new Date()) {
  const lw = lastWeekend(today);
  return { from: isoDate(addDays(parseIso(lw.from), 7)), to: isoDate(addDays(parseIso(lw.to), 7)) };
}
export function lastDays(n, today = new Date()) {
  return { from: isoDate(addDays(today, -(n - 1))), to: isoDate(today) };
}
/** Kommendes Wochenende (Fr–So): Mo–Do das nächste, Fr–So das laufende (ab heute). */
export function comingWeekend(today = new Date()) {
  const dow = today.getDay();
  const sat = addDays(today, dow === 0 ? -1 : 6 - dow);
  const fri = addDays(sat, -1);
  return { from: isoDate(fri > today ? fri : today), to: isoDate(addDays(sat, 1)) };
}
export function nextDays(n, today = new Date()) {
  return { from: isoDate(today), to: isoDate(addDays(today, n - 1)) };
}

export const inRange = (m, { from, to }) => m.date >= from && m.date <= to;

/** „07.–08.11.26“, „31.10.–01.11.26“, „07.11.26“ – aus den tatsächlich gezeigten Spielen. */
export function dateLabel(matches) {
  const ds = matches.map(m => m.date).filter(Boolean).sort();
  if (!ds.length) return '';
  const a = parseIso(ds[0]), b = parseIso(ds[ds.length - 1]);
  const yy = String(b.getFullYear()).slice(2);
  if (ds[0] === ds[ds.length - 1]) return `${pad(a.getDate())}.${pad(a.getMonth() + 1)}.${yy}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${pad(a.getDate())}.–${pad(b.getDate())}.${pad(b.getMonth() + 1)}.${yy}`;
  return `${pad(a.getDate())}.${pad(a.getMonth() + 1)}.–${pad(b.getDate())}.${pad(b.getMonth() + 1)}.${yy}`;
}
export const shortDate = iso => { const d = parseIso(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const weekday = iso => WD[parseIso(iso).getDay()];

// ---------- Anzeige ----------
const STATUS_SHORT = [
  [/^o\.?\s?E\.?$/i, 'o.E.'],
  [/nichtantritt\s+gast/i, 'NA Gast'],
  [/nichtantritt\s+heim/i, 'NA Heim'],
  [/nichtantritt/i, 'Nichtantr.'],
  [/absetzung|abgesetzt/i, 'abgesetzt'],
  [/ausfall/i, 'Ausfall'],
  [/abbruch/i, 'Abbruch'],
  [/^-:-$/, '–:–'],
];

/** Text für die Ergebnis-Spalte: „4:0“, „o.E.“, „NA Gast“ … */
export function scoreText(m) {
  if (m.score) return `${m.score[0]}:${m.score[1]}`;
  const s = (m.status || '').trim();
  for (const [re, label] of STATUS_SHORT) if (re.test(s)) return label;
  return s;
}

/** Hat das Spiel ein zeigbares Ergebnis (inkl. o.E./Nichtantritt)? Spiele ohne Ergebnis oder mit neuem Termin → nein. */
export function isPlayed(m) {
  if (m.score) return true;
  const s = (m.status || '').trim();
  if (!s || /\d{2}\.\d{2}\.\d{4}/.test(s)) return false;
  return true;
}

// ---------- Vorschau (kommende Spiele) ----------
const RESCHEDULED_RE = /(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}))?/;

/** Neuer Termin, wenn fussball.de das Spiel verlegt hat (Status „22.11.2026 11:00“). */
export function rescheduled(m) {
  const r = (m.status || '').match(RESCHEDULED_RE);
  return r ? { date: `${r[3]}-${r[2]}-${r[1]}`, time: r[4] || '' } : null;
}

/** Abgesetzt oder ausgefallen. */
export const isCancelled = m => !m.score && /absetzung|abgesetzt|ausfall/i.test(m.status || '');

/**
 * Spiele, die noch anstehen (kein Ergebnis, kein o.E./Nichtantritt/Abbruch) – verlegte Spiele
 * stehen am neuen Termin (movedFrom = alter Termin). Abgesetzte bleiben drin (zum Abwählen).
 */
export function upcomingMatches(all) {
  return all
    .filter(m => !m.score && !/o\.?\s?E\.?|nichtantritt|abbruch|wertung/i.test(m.status || ''))
    .map(m => {
      const r = rescheduled(m);
      return r ? { ...m, date: r.date, time: r.time || m.time, status: '', movedFrom: m.date } : m;
    })
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

/** Text für die Anstoß-Spalte: „10:30“, „abgesetzt“, „offen“. */
export function kickoffText(m) {
  if (isCancelled(m)) return scoreText(m);
  return m.time || 'offen';
}

/** Spielort kurz: „SpA Liegau-Aug. Kunstrasen, Radeberg“ (Platzart und Straße weg). */
export function venueShort(m) {
  const parts = String(m.venue || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return parts.join(', ');
  const city = parts[parts.length - 1].replace(/^\d{5}\s*/, '');
  const place = parts[1];
  return place.toLowerCase().includes(city.toLowerCase()) ? place : `${place}, ${city}`;
}

/** Ausgang aus Vereinssicht: 'win' | 'draw' | 'loss' | null. Nichtantritt zählt als Sieg/Niederlage. */
export function outcome(m) {
  const ownHome = m.home.own, ownAway = m.away.own;
  if (ownHome === ownAway) return null;
  if (m.score) {
    const [h, a] = m.score;
    const us = ownHome ? h : a, them = ownHome ? a : h;
    return us > them ? 'win' : us < them ? 'loss' : 'draw';
  }
  const s = (m.status || '').toLowerCase();
  if (s.includes('nichtantritt gast')) return ownHome ? 'win' : 'loss';
  if (s.includes('nichtantritt heim')) return ownHome ? 'loss' : 'win';
  return null;
}
export const OUTCOME_LABEL = { win: 'Sieg', draw: 'Remis', loss: 'Niederlage' };

/** Eigene Mannschaft / Gegner aus Vereinssicht. */
export function sides(m) {
  const ownAway = m.away.own && !m.home.own;
  return ownAway
    ? { us: m.away, them: m.home, home: false, score: m.score ? [m.score[1], m.score[0]] : null }
    : { us: m.home, them: m.away, home: true, score: m.score ? [...m.score] : null };
}

/** Mannschaftsbezeichnung fürs Bild: Altersklasse + Zusatz aus dem Vereinsnamen („E-Junioren 2“). */
export function teamLabel(m) {
  const us = sides(m).us;
  const suffix = (us.name.match(/\s(\d+|I{1,3})$/) || [])[1];
  return [m.ageGroup || 'Mannschaft', suffix].filter(Boolean).join(' ');
}

export const logoUrl = id => (id ? `data/logos/${id}.png` : '');
