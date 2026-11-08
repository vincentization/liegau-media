// App-Shell: Hash-Router, Navigation, Service Worker.
// Jede View ist ein Modul mit `title` und `mount(el)`; optional `unmount()`.

const routes = {
  home:    { path: '',        load: () => import('./views/home.js') },
  logo:    { path: 'logo',    load: () => import('./views/logo.js') },
  create:  { path: 'create',  load: () => import('./views/create.js') },
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
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW nicht registriert', err));
  });
}
