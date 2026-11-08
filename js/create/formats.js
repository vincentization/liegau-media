// Ausgabeformate für Social Media. Formate gleicher Größe teilen sich ein Rendering.

export const FORMATS = [
  { id: 'wa-status', label: 'WhatsApp Status',   short: 'WA Status',  w: 1080, h: 1920 },
  { id: 'ig-story',  label: 'Instagram Story',   short: 'IG Story',   w: 1080, h: 1920 },
  { id: 'ig-post',   label: 'Instagram Beitrag', short: 'IG 4:5',     w: 1080, h: 1350 },
  { id: 'ig-square', label: 'Instagram Quadrat', short: 'IG 1:1',     w: 1080, h: 1080 },
  { id: 'fb-post',   label: 'Facebook Beitrag',  short: 'FB quer',    w: 1200, h: 630 },
  { id: 'fb-story',  label: 'Facebook Story',    short: 'FB Story',   w: 1080, h: 1920 },
];

const GROUP_INFO = {
  '1080x1920': { name: 'Story 9:16',     tab: 'Story',   ratio: '9:16',   token: 'story',  story: true },
  '1080x1350': { name: 'Hochformat 4:5', tab: 'Hoch',    ratio: '4:5',    token: 'post',   story: false },
  '1080x1080': { name: 'Quadrat 1:1',    tab: 'Quadrat', ratio: '1:1',    token: 'square', story: false },
  '1200x630':  { name: 'Quer 1,91:1',    tab: 'Quer',    ratio: '1,91:1', token: 'quer',   story: false },
};

export const formatById = id => FORMATS.find(f => f.id === id);

/** Gewählte Format-IDs → Gruppen gleicher Größe (Reihenfolge wie FORMATS). */
export function groupsFor(ids) {
  const groups = new Map();
  for (const f of FORMATS) {
    if (!ids.includes(f.id)) continue;
    const key = `${f.w}x${f.h}`;
    if (!groups.has(key)) groups.set(key, { key, w: f.w, h: f.h, ...GROUP_INFO[key], formats: [] });
    groups.get(key).formats.push(f);
  }
  return [...groups.values()];
}

/** Dateiname-Kürzel: bei einem Format dessen ID, sonst Gruppenkürzel. */
export const groupToken = g => (g.formats.length === 1 ? g.formats[0].id : g.token);
export const groupLabel = g => `${g.formats.map(f => f.label).join(' / ')} (${g.w}×${g.h})`;
