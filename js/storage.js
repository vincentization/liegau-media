// Archiv-Speicher – öffentliche Schnittstelle.
//
// Item-Form:
// {
//   id: string,
//   createdAt: number (ms),
//   kind: 'image' | 'video' | 'logo',
//   format: string,        // z. B. 'ig-story', 'ig-post', 'wa-status', 'fb-post', 'logo-png', 'logo-svg'
//   formatLabel: string,   // z. B. 'Instagram Story (1080×1920)'
//   title: string,         // Überschrift / kurze Beschreibung
//   mime: string,
//   width: number, height: number,
//   size: number,          // Bytes
//   blob: Blob,            // nur bei getItem()/saveItem
//   thumb: Blob,           // kleines JPEG-Vorschaubild (max. 400px)
//   meta: object,          // frei: Einstellungen, um später neu zu bearbeiten
// }
//
// Zusätzlich (nur lesend, von listItems/getItem gesetzt):
//   thumbUrl?: string      // signierte URL, wenn das Vorschaubild nur in der Cloud liegt
//   cloud?: boolean        // true = liegt (auch) im Cloud-Archiv
//
// Speicherorte:
//   • Standard: IndexedDB auf diesem Gerät (offline, ohne Einrichtung).
//   • Optional: gemeinsames Cloud-Archiv über Supabase, wenn js/config.js ausgefüllt ist
//     und jemand mit dem Vereins-Login angemeldet ist. Lokale Kopien dienen dann als Cache.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { uid } from './util.js';

const THUMB_MAX = 400;
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const BUCKET = 'media';
const TABLE = 'media_items';

export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/* ------------------------------------------------------------------ */
/* Änderungs-Ereignis (auch über Tabs hinweg)                          */
/* ------------------------------------------------------------------ */

const bus = new EventTarget();
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('svl-media') : null;
channel?.addEventListener('message', () => bus.dispatchEvent(new Event('change')));

function emitChange() {
  bus.dispatchEvent(new Event('change'));
  channel?.postMessage('change');
}

/** Bei Änderungen am Archiv (speichern, löschen, an-/abmelden) benachrichtigen. Gibt eine Abmelde-Funktion zurück. */
export function onChange(cb) {
  const h = () => cb();
  bus.addEventListener('change', h);
  return () => bus.removeEventListener('change', h);
}

/* ------------------------------------------------------------------ */
/* IndexedDB (lokal)                                                   */
/* ------------------------------------------------------------------ */
// Store "items": Metadaten + Vorschaubild (schnelle Liste)
// Store "blobs": { id, blob } – die großen Dateien getrennt

let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('svl-media', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('items', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...stores.map(s => t.objectStore(s)))).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

const local = {
  put: (item, blob) => tx(['items', 'blobs'], 'readwrite', (items, blobs) => {
    items.put(item);
    if (blob) blobs.put({ id: item.id, blob });
  }),
  list: () => tx(['items'], 'readonly', items => reqP(items.getAll())),
  get: id => tx(['items', 'blobs'], 'readonly', async (items, blobs) => {
    const [item, b] = await Promise.all([reqP(items.get(id)), reqP(blobs.get(id))]);
    return item ? { ...item, blob: b?.blob || null } : null;
  }),
  meta: id => tx(['items'], 'readonly', items => reqP(items.get(id))),
  delete: id => tx(['items', 'blobs'], 'readwrite', (items, blobs) => { items.delete(id); blobs.delete(id); }),
};

/* ------------------------------------------------------------------ */
/* Vorschaubilder                                                      */
/* ------------------------------------------------------------------ */

function withObjectUrl(blob, fn) {
  const url = URL.createObjectURL(blob);
  return Promise.resolve(fn(url)).finally(() => URL.revokeObjectURL(url));
}

function drawThumb(source, w, h, transparent, upscale = false) {
  const s = upscale ? THUMB_MAX / Math.max(w, h) : Math.min(1, THUMB_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  if (transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

async function imageThumb(blob, item) {
  return withObjectUrl(blob, url => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      // SVGs ohne feste Größe: Maße aus dem Item verwenden
      const w = img.naturalWidth || item.width || THUMB_MAX;
      const h = img.naturalHeight || item.height || THUMB_MAX;
      item.width ||= w; item.height ||= h;
      // SVG ist verlustfrei skalierbar → immer in voller Vorschaugröße rastern
      try { resolve(await drawThumb(img, w, h, true, item.mime.startsWith('image/svg'))); } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Vorschaubild konnte nicht erzeugt werden'));
    img.src = url;
  }));
}

async function videoThumb(blob, item) {
  return withObjectUrl(blob, url => new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const timer = setTimeout(() => reject(new Error('Video-Vorschau: Zeitüberschreitung')), 8000);
    v.onloadedmetadata = () => {
      item.width ||= v.videoWidth; item.height ||= v.videoHeight;
      v.currentTime = Math.min(0.5, (v.duration || 1) / 4);
    };
    v.onseeked = async () => {
      clearTimeout(timer);
      try { resolve(await drawThumb(v, v.videoWidth, v.videoHeight, false)); } catch (e) { reject(e); }
    };
    v.onerror = () => { clearTimeout(timer); reject(new Error('Video konnte nicht gelesen werden')); };
    v.src = url;
  }));
}

async function makeThumb(item) {
  const { blob, mime = '' } = item;
  try {
    if (mime.startsWith('image/')) return await imageThumb(blob, item);
    if (mime.startsWith('video/')) return await videoThumb(blob, item);
  } catch (e) { console.warn(e); }
  return null;
}

/* ------------------------------------------------------------------ */
/* Supabase (optionales Cloud-Archiv)                                  */
/* ------------------------------------------------------------------ */

let clientPromise;
function client() {
  if (!cloudConfigured) return Promise.resolve(null);
  clientPromise ||= import(SUPABASE_ESM).then(({ createClient }) => {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: 'svl-media-auth' } });
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') emitChange(); });
    return sb;
  }).catch(err => { clientPromise = null; throw err; });
  return clientPromise;
}

/** Aktueller Cloud-Nutzer ({ email }) oder null (nicht eingerichtet / nicht angemeldet / offline ohne Sitzung). */
export async function getCloudUser() {
  if (!cloudConfigured) return null;
  try {
    const sb = await client();
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  } catch (e) { console.warn('Cloud nicht erreichbar', e); return null; }
}

export async function signIn(email, password) {
  const sb = await client();
  if (!sb) throw new Error('Cloud-Archiv ist nicht eingerichtet');
  const { error } = await sb.auth.signInWithPassword({ email, password }).catch(e => ({ error: e }));
  if (error) {
    const msg = String(error.message || error);
    if (/invalid login credentials/i.test(msg)) throw new Error('E-Mail oder Passwort falsch');
    if (/fetch|network|load failed/i.test(msg) || error.status === 0) throw new Error('Keine Verbindung zum Cloud-Archiv');
    throw new Error(msg);
  }
  emitChange();
}

export async function signOut() {
  const sb = await client();
  await sb?.auth.signOut();
  emitChange();
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
export const extFor = mime => EXT[(mime || '').split(';')[0]] || 'bin';

const rowToItem = r => ({
  id: r.id, createdAt: new Date(r.created_at).getTime(), kind: r.kind, format: r.format,
  formatLabel: r.format_label, title: r.title, mime: r.mime, width: r.width, height: r.height,
  size: r.size, meta: r.meta || {}, path: r.path, thumbPath: r.thumb_path, cloud: true,
});

async function cloudUpload(sb, item, blob) {
  const path = `${item.id}/datei.${extFor(item.mime)}`;
  const thumbPath = item.thumb ? `${item.id}/vorschau.jpg` : null;
  const up = async (p, b, type) => {
    const { error } = await sb.storage.from(BUCKET).upload(p, b, { contentType: type, upsert: true });
    if (error) throw error;
  };
  await up(path, blob, item.mime);
  if (thumbPath) await up(thumbPath, item.thumb, 'image/jpeg');
  const { error } = await sb.from(TABLE).insert({
    id: item.id, created_at: new Date(item.createdAt).toISOString(), kind: item.kind, format: item.format,
    format_label: item.formatLabel, title: item.title, mime: item.mime, width: item.width, height: item.height,
    size: item.size, meta: item.meta, path, thumb_path: thumbPath,
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Öffentliche Funktionen                                              */
/* ------------------------------------------------------------------ */

let persistAsked = false;
/** Browser bitten, den lokalen Speicher nicht automatisch zu löschen. */
export async function requestPersist() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* egal */ }
}

/** Speichert ein Item (lokal und – wenn angemeldet – im Cloud-Archiv). Gibt das Item ohne Blob zurück. */
export async function saveItem(input) {
  if (!(input?.blob instanceof Blob)) throw new Error('saveItem: blob fehlt');
  const blob = input.blob;
  const item = {
    id: input.id || uid(),
    createdAt: input.createdAt || Date.now(),
    kind: input.kind || (blob.type.startsWith('video/') ? 'video' : 'image'),
    format: input.format || '',
    formatLabel: input.formatLabel || '',
    title: input.title || '',
    mime: input.mime || blob.type || 'application/octet-stream',
    width: input.width || 0,
    height: input.height || 0,
    size: input.size || blob.size,
    thumb: input.thumb || null,
    meta: input.meta || {},
    cloud: false,
  };
  if (!item.thumb) {
    const work = { ...item, blob };
    item.thumb = await makeThumb(work); // ergänzt ggf. width/height in `work`
    item.width ||= work.width || 0;
    item.height ||= work.height || 0;
  }

  requestPersist();
  await local.put(item, blob);

  if (cloudConfigured && await getCloudUser()) {
    try {
      await cloudUpload(await client(), item, blob);
      item.cloud = true;
      await local.put(item);
    } catch (e) {
      console.warn('Cloud-Upload fehlgeschlagen – nur lokal gespeichert', e);
      item.cloudError = String(e?.message || e);
    }
  }
  emitChange();
  return item;
}

/** Alle Items, neueste zuerst – ohne große Datei (mit Vorschaubild). */
export async function listItems() {
  const locals = await local.list();
  let items = locals;

  if (cloudConfigured && await getCloudUser()) {
    try {
      const sb = await client();
      const { data: rows, error } = await sb.from(TABLE).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const byId = new Map(locals.map(i => [i.id, i]));
      const cloudIds = new Set(rows.map(r => r.id));
      // Lokale Cache-Kopien entfernen, die im Team-Archiv gelöscht wurden
      for (const i of locals) if (i.cloud && !cloudIds.has(i.id)) local.delete(i.id);
      // Fehlende Vorschaubilder als signierte URLs holen
      const need = rows.filter(r => r.thumb_path && !byId.get(r.id)?.thumb).map(r => r.thumb_path);
      const urls = new Map();
      if (need.length) {
        const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60);
        data?.forEach(d => d.signedUrl && urls.set(d.path, d.signedUrl));
      }
      items = [
        ...rows.map(r => ({ ...rowToItem(r), thumb: byId.get(r.id)?.thumb || null, thumbUrl: urls.get(r.thumb_path) })),
        ...locals.filter(i => !i.cloud), // noch nicht hochgeladene lokale Items
      ];
    } catch (e) {
      console.warn('Cloud-Archiv nicht erreichbar – zeige lokale Kopien', e);
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/** Ein Item inkl. Datei (blob). Lädt sie bei Bedarf aus der Cloud und legt eine lokale Kopie an. */
export async function getItem(id) {
  const cached = await local.get(id);
  if (cached?.blob) return cached;
  if (!cloudConfigured || !(await getCloudUser())) return cached;

  const sb = await client();
  const { data: row, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const item = rowToItem(row);
  const dl = async p => { const { data, error: e } = await sb.storage.from(BUCKET).download(p); if (e) throw e; return data; };
  const blob = await dl(row.path);
  item.thumb = row.thumb_path ? await dl(row.thumb_path).catch(() => null) : null;
  await local.put(item, blob).catch(() => {});
  return { ...item, blob };
}

/** Löscht ein Item lokal und (wenn angemeldet) im Cloud-Archiv. */
export async function deleteItem(id) {
  const meta = await local.meta(id);
  if (cloudConfigured && await getCloudUser()) {
    const sb = await client();
    const { data: row } = await sb.from(TABLE).select('path,thumb_path').eq('id', id).maybeSingle();
    if (row) {
      const { error } = await sb.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      await sb.storage.from(BUCKET).remove([row.path, row.thumb_path].filter(Boolean));
    }
  } else if (meta?.cloud && cloudConfigured) {
    throw new Error('Zum Löschen aus dem Cloud-Archiv bitte anmelden');
  }
  await local.delete(id);
  emitChange();
}

/** Lädt lokale, noch nicht hochgeladene Items ins Cloud-Archiv. Gibt die Anzahl zurück. */
export async function uploadLocalItems(onProgress) {
  const sb = await client();
  if (!sb || !(await getCloudUser())) throw new Error('Bitte zuerst anmelden');
  const pending = (await local.list()).filter(i => !i.cloud);
  let done = 0;
  for (const meta of pending) {
    const { blob, ...item } = await local.get(meta.id);
    if (!blob) continue;
    await cloudUpload(sb, item, blob);
    await local.put({ ...item, cloud: true });
    onProgress?.(++done, pending.length);
  }
  emitChange();
  return done;
}

/** Anzahl lokaler Items, die noch nicht im Cloud-Archiv liegen. */
export async function countLocalOnly() {
  return (await local.list()).filter(i => !i.cloud).length;
}

/** { mode: 'local'|'cloud', configured, usage, quota, persisted, user? } */
export async function getStorageInfo() {
  const user = await getCloudUser();
  let usage = 0, quota = 0, persisted = false;
  try {
    ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
    persisted = await navigator.storage.persisted();
  } catch { /* nicht unterstützt */ }
  return {
    mode: user ? 'cloud' : 'local',
    configured: cloudConfigured,
    usage, quota, persisted,
    user: user ? user.email : undefined,
  };
}
