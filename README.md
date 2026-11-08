# SV Liegau Media

Kleine Web-App (PWA) für die Social-Media-Arbeit des **SV Liegau-Augustusbad 1951 e.V.** – optimiert fürs Handy.

**App öffnen:** https://vincentization.github.io/liegau-media/

## Was die App kann

- **Logo** – Hallencup-Logo anpassen und als PNG/SVG exportieren.
- **Erstellen** – Beiträge im Vereinsdesign für Instagram (Post/Story), WhatsApp-Status und Facebook erzeugen.
- **Archiv** – alle gespeicherten Bilder, Videos und Logos ansehen, teilen, herunterladen oder löschen.
- Funktioniert offline und lässt sich wie eine normale App installieren.

## Aufs Handy holen

- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**.
- **Android (Chrome):** Seite öffnen → Menü ⋮ → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.

## Wo wird gespeichert?

Standardmäßig speichert jedes Gerät sein **eigenes Archiv lokal im Browser** (IndexedDB). Das funktioniert ohne Einrichtung und offline, ist aber nicht zwischen Geräten geteilt. Achtung: Wer die Browserdaten löscht, löscht auch das lokale Archiv – wichtige Dateien also zusätzlich herunterladen.

Optional kann ein **gemeinsames Cloud-Archiv** eingerichtet werden (siehe unten). Dann sieht das ganze Team nach Anmeldung mit dem Vereins-Login dieselben Medien.

## Lokale Entwicklung

Kein Build-Schritt, keine Abhängigkeiten – nur statische Dateien (HTML, CSS, JavaScript-Module).

```sh
python3 -m http.server 5173
```

Dann http://localhost:5173 öffnen. Auf `localhost` lädt der Service Worker Dateien immer zuerst frisch aus dem Netz, Änderungen sind also nach einem Neuladen sichtbar.

Hinweise:
- Nur **relative URLs** verwenden (die Seite läuft unter `/liegau-media/`).
- Neue Dateien werden vom Service Worker automatisch gecacht. Bei grundlegenden Änderungen `VERSION` in `sw.js` erhöhen.

## Veröffentlichen (GitHub Pages)

1. Einmalig: Repository auf GitHub → **Settings → Pages → Source: „GitHub Actions“**.
2. Jeder Push auf `main` veröffentlicht die App automatisch (`.github/workflows/pages.yml`). Manuell geht es unter **Actions → GitHub Pages → Run workflow**.

## Gemeinsames Cloud-Archiv (optional, Supabase)

Kostenlos im Free-Tarif von [Supabase](https://supabase.com) (500 MB Datenbank, 1 GB Dateispeicher, max. 50 MB pro Datei). Die Website ist öffentlich – deshalb kann **nur lesen, hochladen und löschen, wer mit dem Vereins-Login angemeldet ist**.

1. Auf supabase.com kostenlos registrieren und ein **neues Projekt** anlegen (Region z. B. Frankfurt).
2. Im Dashboard **SQL Editor** öffnen, den Inhalt von [`supabase/setup.sql`](supabase/setup.sql) einfügen und **Run** klicken.
   Das legt die Tabelle `media_items`, den privaten Speicher-Bucket `media` und alle Zugriffsregeln an.
   Falls der Bucket danach unter **Storage** fehlt: dort manuell einen Bucket `media` anlegen (**nicht** öffentlich) und das Skript erneut ausführen.
3. **Authentication → Users → Add user → Create new user**: eine E-Mail-Adresse und ein starkes Passwort für den gemeinsamen **Vereins-Login** anlegen („Auto Confirm User“ anhaken).
4. **Authentication → Sign In / Providers**: **„Allow new users to sign up“ ausschalten**, damit sich niemand selbst ein Konto anlegen kann.
5. **Project Settings → API**: **Project URL** und den **anon public**-Key kopieren und in [`js/config.js`](js/config.js) eintragen:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ…';
   ```
   Niemals den `service_role`-Key eintragen!
6. Committen und pushen. In der App unter **Archiv → Cloud-Archiv** mit dem Vereins-Login anmelden. Bereits lokal gespeicherte Medien lassen sich dort mit einem Tipp hochladen.

Ohne Anmeldung (oder offline) speichert die App weiterhin lokal auf dem Gerät. Das Passwort des Vereins-Logins kann jederzeit unter **Authentication → Users** geändert werden.

## Lizenzen

- Schrift **Titillium Web** (Accademia di Belle Arti di Urbino) – SIL Open Font License 1.1, siehe [`fonts/OFL.txt`](fonts/OFL.txt).
- Vereinslogo und Vereinsname: SV Liegau-Augustusbad 1951 e.V.
