// App-Shell: Hash-Router, Navigation, Service Worker.
// Jede View ist ein Modul mit `title` und `mount(el)`; optional `unmount()`.

const routes = {
  home:    { path: '',        load: () => import('./views/home.js') },
  logo:    { path: 'logo',    load: () => import('./views/logo.js') },
  create:  { path: 'create',  load: () => import('./views/create.js') },
  results: { path: 'results', load: () => import('./views/results.js') },
  archive: { path: 'archive', load: () => import('./views/archive.js') },
};

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('view-title');
let current = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const name = Object.keys(routes).find(k => routes[k].path === path) || 'home';
  return { name, params: Object.fromEntries(new URLSearchParams(query)) };
}

async function render() {
  const { name, params } = parseHash();
  try { current?.unmount?.(); } catch (e) { console.error(e); }
  current = null;

  document.querySelectorAll('.tabbar a').forEach(a => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  viewEl.innerHTML = '';
  try {
    const mod = await routes[name].load();
    // Falls während des Ladens erneut navigiert wurde, nichts mehr tun.
    if (parseHash().name !== name) return;
    titleEl.textContent = mod.title || '';
    current = mod;
    await mod.mount(viewEl, params);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="card"><h2>Fehler</h2><p>Dieser Bereich konnte nicht geladen werden.</p><pre class="small muted">${String(err?.message || err)}</pre></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' → sw.js wird nie aus dem HTTP-Cache geprüft.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(err => console.warn('SW nicht registriert', err));
  });
}

// ---------- Aktualisieren-Button (oben rechts) ----------
// Holt den neuesten veröffentlichten Stand – auch in der vom Homescreen gestarteten App:
//  1. Service Worker auf neue Version prüfen (und ggf. sofort aktivieren),
//  2. alle gecachten App-Dateien am HTTP-Cache vorbei neu laden (sw.js → 'refresh'),
//  3. Seite neu laden.
// Offline bleibt der alte Cache unangetastet, die App funktioniert also weiter.

const refreshBtn = document.getElementById('app-refresh');
refreshBtn.addEventListener('click', refreshApp);

async function refreshApp() {
  if (refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('is-busy');
  try {
    if (navigator.onLine === false) throw new Error('offline');
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) {
      await reg.update();                       // wirft, wenn sw.js nicht erreichbar ist
      await waitUntilActive(reg.installing || reg.waiting);
      const sw = reg.active;
      const result = sw && await askWorker(sw, { type: 'refresh' }, 20000);
      if (result && !result.ok) throw new Error('offline');
    }
    location.reload();
  } catch (err) {
    console.warn('Aktualisieren fehlgeschlagen', err);
    const { toast } = await import('./util.js');
    toast('Keine Verbindung – bitte später erneut versuchen.', { error: true });
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('is-busy');
  }
}

/** Wartet, bis ein neu installierter Service Worker aktiv ist (max. 10 s). */
function waitUntilActive(worker) {
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise(resolve => {
    const t = setTimeout(resolve, 10000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') { clearTimeout(t); resolve(); }
    });
  });
}

/** Schickt dem Service Worker eine Nachricht und wartet auf die Antwort (null bei Zeitüberschreitung). */
function askWorker(worker, message, ms) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    channel.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
    worker.postMessage(message, [channel.port2]);
  });
}
