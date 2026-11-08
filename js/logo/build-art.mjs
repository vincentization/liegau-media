// Einmal-Skript (Node): zieht die statischen Grafikteile aus den Illustrator-Vorlagen
// und schreibt sie als JS-Module (art-gruen.js, art-silber.js).
// Aufruf:  node js/logo/build-art.mjs
// Nur nötig, wenn sich die Vorlagen in assets/hallencup-vorlagen ändern.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../assets/hallencup-vorlagen');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n');

/** Zeilen [from..to] (1-basiert, inklusive), mit Prüfung des ersten Zeileninhalts. */
function lines(arr, from, to, expectStart) {
  if (expectStart && !arr[from - 1].trim().startsWith(expectStart)) {
    throw new Error(`Zeile ${from}: erwartet "${expectStart}", gefunden "${arr[from - 1].trim().slice(0, 40)}"`);
  }
  return arr.slice(from - 1, to).map(l => l.trim()).join('');
}

/** IDs entfernen (Kollisionen vermeiden), Clip-Path-IDs eindeutig präfixen. */
function clean(s) {
  return s
    .replace(/ data-name="[^"]*"/g, '')
    .replace(/ id="(?!clippath)[^"]*"/g, '')
    .replace(/id="clippath/g, 'id="hcs-clip')
    .replace(/url\(#clippath/g, 'url(#hcs-clip');
}

const r2 = read('Hallencup-2026-reg-02.svg');
const r3 = read('Hallencup-2026-reg-03.svg');
const sv = read('Hallencup-2026-reg_Silber.svg');

const gruen = {
  ring: clean(lines(r2, 3, 6, '<g>')),
  badgeShort: clean(lines(r2, 7, 11, '<g id="og">')),
  badgeTall: clean(lines(r3, 7, 11, '<g id="og">')),
  emblem: clean(lines(r2, 12, 58, '<g>')),
  ribbon: clean(lines(r2, 59, 62, '<g>')),
  bannerShadow: clean(lines(r2, 81, 81, '<rect')),
  banner: clean(lines(r2, 83, 83, '<path')),
};

const silber = {
  defs: clean(lines(sv, 3, 85, '<defs>')),
  ring: clean(lines(sv, 86, 89, '<g>')),
  badge: clean(lines(sv, 90, 95, '<g id="bg">')),
  badgeBevel: clean(lines(sv, 96, 292, '<g id="bg-2"')),
  emblem: clean(lines(sv, 293, 339, '<g>')),
  ribbon: clean(lines(sv, 341, 344, '<g>')),
  bannerShadow: clean(lines(sv, 364, 364, '<rect id="shadow"')),
  banner: clean(lines(sv, 365, 1420, '<g id="shape">')),
};

const header = '// AUTOMATISCH ERZEUGT von js/logo/build-art.mjs – nicht von Hand bearbeiten.\n// Statische Grafikteile aus assets/hallencup-vorlagen (Texte werden separat erzeugt).\n';
for (const [name, obj] of [['gruen', gruen], ['silber', silber]]) {
  const body = Object.entries(obj).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n');
  fs.writeFileSync(path.join(here, `art-${name}.js`), `${header}export default {\n${body}\n};\n`);
  console.log(`art-${name}.js`, Object.keys(obj).join(', '));
}
