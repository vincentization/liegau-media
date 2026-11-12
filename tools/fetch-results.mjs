#!/usr/bin/env node
// Lädt alle Spiele des Vereins von fussball.de und schreibt data/results.json.
//
// fussball.de hat keine offizielle API und erlaubt keine Abrufe direkt aus dem
// Browser (kein CORS). Deshalb läuft dieses Skript im GitHub-Pages-Workflow
// (.github/workflows/pages.yml) vor jeder Veröffentlichung – und lokal mit:
//
//   node tools/fetch-results.mjs            # Standard: letzte 120 Tage bis +21 Tage
//   node tools/fetch-results.mjs 2026-08-01 2026-11-30
//
// Die Ergebnisse sind auf fussball.de per Web-Schrift verschleiert: Jede Ziffer
// ist ein privates Unicode-Zeichen, das erst die zugehörige Schrift (export.fontface)
// als Ziffer darstellt. Die Glyphen dieser Schrift heißen „zero“, „one“ … –
// darüber werden die Zeichen zurück in Ziffern übersetzt (opentype.js aus vendor/).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const CLUB_ID = '00ES8GNBRC00007UVV0AG08LVUPGND5I';
const BASE = 'https://www.fussball.de';
const UA = 'Mozilla/5.0 (compatible; SV-Liegau-Media/1.0; +https://vincentization.github.io/liegau-media/)';
const PAGE_SIZE = 100;
const ROOT = new URL('..', import.meta.url);
const DIGITS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', hyphen: '-' };

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

async function get(url, type = 'text') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

// ---------- Schrift-Entschlüsselung ----------
let opentype;
async function loadOpentype() {
  if (opentype) return opentype;
  const src = await readFile(new URL('vendor/opentype.min.js', ROOT), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return (opentype = ctx.opentype);
}

const fontMaps = new Map();
async function fontMap(id) {
  if (!fontMaps.has(id)) {
    fontMaps.set(id, (async () => {
      const ot = await loadOpentype();
      const buf = await get(`${BASE}/export.fontface/-/format/woff/id/${encodeURIComponent(id)}/type/font`, 'buffer');
      const font = ot.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
      const map = new Map();
      for (let i = 0; i < font.glyphs.length; i++) {
        const g = font.glyphs.get(i);
        const ch = DIGITS[g.name];
        if (ch) for (const u of g.unicodes) map.set(u, ch);
      }
      if (!map.size) throw new Error(`Schrift ${id}: keine Ziffern gefunden`);
      return map;
    })());
  }
  return fontMaps.get(id);
}

async function decode(id, entities) {
  const map = await fontMap(id);
  let out = '';
  for (const m of entities.matchAll(/&#x([0-9a-f]+);/gi)) {
    const ch = map.get(parseInt(m[1], 16));
    if (ch == null) throw new Error(`Unbekanntes Zeichen ${m[0]} (Schrift ${id})`);
    out += ch;
  }
  return out;
}

// ---------- HTML zerlegen ----------
const decodeHtml = s => s
  .replace(/&#8203;/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = s => decodeHtml(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseTeam(cell) {
  if (!cell) return null;
  const info = cell.match(/class="info-text">([^<]*)/);
  if (!/club-name/.test(cell)) return info ? { placeholder: text(info[1]) } : null;
  const href = cell.match(/href="([^"]+)"/)?.[1] || '';
  const logoId = cell.match(/getLogo\/format\/\d+\/id\/([A-Z0-9]+)/)?.[1] || '';
  const name = text(cell.match(/class="club-name">([\s\S]*?)<\/div>/)?.[1]);
  return {
    name,
    teamId: href.match(/team-id\/([A-Z0-9]+)/)?.[1] || '',
    logoId,
    own: logoId === CLUB_ID,
  };
}

const MONTHS_RE = /(\d{2})\.(\d{2})\.(\d{4})(?: - (\d{1,2}:\d{2}) Uhr)?/;

async function parseMatches(html) {
  const matches = [];
  // Jedes Spiel beginnt mit einer Kopfzeile: „Samstag, 07.11.2026 - 10:00 Uhr | F-Junioren | Kinderfußball“
  const blocks = html.split('<tr class="row-headline visible-small">').slice(1);
  for (const block of blocks) {
    const head = text(block.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1]);
    const [when, ...comp] = head.split(' | ');
    const dm = when.match(MONTHS_RE);
    if (!dm) continue;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const time = dm[4] || '';
    const ageGroup = (comp[0] || '').trim();
    const competition = comp.slice(1).join(' | ').trim();

    // Die Spielzeile ist die erste <tr> ohne row-competition/row-venue, die column-club enthält.
    const rowM = block.match(/<tr(?: class="odd")?>\s*<td class="hidden-small"><\/td>([\s\S]*?)<\/tr>/);
    if (!rowM) continue;
    const row = rowM[1];
    const cells = [...row.matchAll(/<td class="column-club[^"]*">([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const home = parseTeam(cells[0]);
    const away = parseTeam(cells[1]);
    if (!home || !away || home.placeholder || away.placeholder) continue; // „spielfrei“

    const scoreCell = row.match(/<td class="column-score">([\s\S]*?)<\/td>/)?.[1] || '';
    const url = scoreCell.match(/href="([^"]+)"/)?.[1] || '';
    const id = url.match(/\/spiel\/([A-Z0-9]+)$/)?.[1] || `${date}-${home.teamId}-${away.teamId}`;
    let score = null, status = '', note = '';
    const left = scoreCell.match(/data-obfuscation="([^"]+)" class="score-left">([^<]*)</);
    const right = scoreCell.match(/data-obfuscation="([^"]+)" class="score-right">([^<]*)</);
    if (left && right) {
      const h = await decode(left[1], left[2]);
      const a = await decode(right[1], right[2]);
      if (/^\d+$/.test(h) && /^\d+$/.test(a)) score = [+h, +a];
      else status = `${h}:${a}`; // z. B. „-:-“
      const info = scoreCell.match(/class="info-text">([^<]*)/);
      if (info) note = text(info[1]); // z. B. „u“ (Umwertung)
    } else {
      const info = scoreCell.match(/class="info-text">([^<]*)/);
      if (info) status = text(info[1]); // „o.E.“, „Absetzung“, „Nichtantritt GAST“, neuer Termin …
    }
    // Spielort (dank show-venues): „Kunstrasenplatz, SpA Liegau-Aug. Kunstrasen, Zum Sportplatz 14, 01454 Radeberg“
    const venue = text(block.match(/<tr class="[^"]*row-venue[^"]*">[\s\S]*?<td colspan="3">([\s\S]*?)<\/td>/)?.[1]);
    matches.push({
      id, date, time, ageGroup, competition, venue,
      home: { name: home.name, logo: home.logoId, own: home.own },
      away: { name: away.name, logo: away.logoId, own: away.own },
      score, status, note,
      verified: /icon-verified/.test(scoreCell),
      url,
    });
  }
  return matches;
}

export async function fetchResults(from, to) {
  const all = [];
  for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
    const url = `${BASE}/ajax.club.matchplan/-/id/${CLUB_ID}/mime-type/JSON/mode/PAGE/show-filter/false/max/${PAGE_SIZE}/datum-von/${from}/datum-bis/${to}/show-venues/checked/offset/${offset}`;
    const json = JSON.parse(await get(url));
    if (!json.success) throw new Error('fussball.de: success=false');
    all.push(...await parseMatches(json.html || ''));
    if (json.final !== false) break;
  }
  const seen = new Set();
  return all.filter(m => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ---------- Logos ----------
// fussball.de liefert Logos ohne CORS-Header – im Browser würden sie das Canvas
// „verunreinigen“ und den Export verhindern. Darum werden sie hier mit abgelegt
// (data/logos/<id>.png, 200×200) und von der App von derselben Herkunft geladen.
async function downloadLogos(matches) {
  const dir = new URL('data/logos/', ROOT);
  await mkdir(dir, { recursive: true });
  const ids = [...new Set(matches.flatMap(m => [m.home.logo, m.away.logo]).filter(Boolean))];
  let failed = 0;
  const queue = [...ids];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let id; (id = queue.shift());) {
      try {
        const png = await get(`${BASE}/export.media/-/action/getLogo/format/9/id/${id}`, 'buffer');
        await writeFile(new URL(`${id}.png`, dir), png);
      } catch (e) { failed++; console.warn('Logo fehlt:', id, e.message); }
    }
  }));
  // Fehlende Logos aus den Daten entfernen → App zeichnet dann Initialen.
  if (failed) {
    const { access } = await import('node:fs/promises');
    for (const m of matches) for (const t of [m.home, m.away]) {
      if (t.logo) await access(new URL(`${t.logo}.png`, dir)).catch(() => { t.logo = ''; });
    }
  }
  return ids.length - failed;
}

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = new Date();
  const from = process.argv[2] || iso(addDays(now, -120));
  const to = process.argv[3] || iso(addDays(now, 21)); // +21 Tage für Vorschau-Beiträge
  const out = new URL('data/results.json', ROOT);
  await mkdir(new URL('data/', ROOT), { recursive: true });
  try {
    const matches = await fetchResults(from, to);
    const logos = await downloadLogos(matches);
    console.log(`✔ ${logos} Logos → data/logos/`);
    const data = { generatedAt: now.toISOString(), source: `${BASE}/verein/-/id/${CLUB_ID}`, from, to, matches };
    await writeFile(out, JSON.stringify(data, null, 1) + '\n');
    const withScore = matches.filter(m => m.score).length;
    console.log(`✔ ${matches.length} Spiele (${withScore} mit Ergebnis) von ${from} bis ${to} → data/results.json`);
  } catch (e) {
    // Seite trotzdem veröffentlichen: Die App zeigt dann den Fehler und erlaubt manuelle Eingabe.
    console.error('✘ Abruf fehlgeschlagen:', e.message);
    await writeFile(out, JSON.stringify({ generatedAt: now.toISOString(), error: e.message, from, to, matches: [] }, null, 1) + '\n');
    if (process.env.STRICT) process.exitCode = 1;
  }
}
