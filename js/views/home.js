import { html } from '../util.js';

export const title = '';

const ICONS = {
  logo: '<svg viewBox="0 0 24 24"><path d="M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/></svg>',
  create: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4" fill="none" stroke-width="2" stroke-linejoin="round"/></svg>',
  results: '<svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z M12 5v14 M7 10v4 M16 10h2v4h-2z" fill="none" stroke-width="2" stroke-linejoin="round"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><path d="M3 4h18v4H3z M5 8h14v12H5z M10 12h4" fill="none" stroke-width="2" stroke-linejoin="round"/></svg>',
};

export function mount(el) {
  el.append(html`
    <div>
      <section class="hero">
        <p class="eyebrow" style="color:#fff;opacity:.85">SV Liegau-Augustusbad 1951 e.V.</p>
        <h1>Social Media leicht gemacht</h1>
        <p>Logos anpassen, Beiträge gestalten, Ergebnisse posten und alles an einem Ort sammeln.</p>
      </section>
      <div class="tiles">
        <a class="tile" href="#/create">
          <span class="tile-icon">${ICONS.create}</span>
          <span><h3>Beitrag erstellen</h3><p>Foto oder Video laden, Text &amp; Logo drauf, für WhatsApp, Instagram &amp; Facebook exportieren.</p></span>
          <span class="chev">›</span>
        </a>
        <a class="tile" href="#/results">
          <span class="tile-icon">${ICONS.results}</span>
          <span><h3>Ergebnisse posten</h3><p>Alle Ergebnisse vom Wochenende direkt von fussball.de – als Übersicht oder einzelnes Highlight.</p></span>
          <span class="chev">›</span>
        </a>
        <a class="tile" href="#/logo">
          <span class="tile-icon">${ICONS.logo}</span>
          <span><h3>Hallencup-Logo</h3><p>Ausgabe, Datum und Zusatz anpassen und als PNG oder SVG speichern.</p></span>
          <span class="chev">›</span>
        </a>
        <a class="tile" href="#/archive">
          <span class="tile-icon">${ICONS.archive}</span>
          <span><h3>Archiv</h3><p>Alle erstellten Beiträge und Logos wiederfinden, teilen oder löschen.</p></span>
          <span class="chev">›</span>
        </a>
      </div>
    </div>
  `);
}
