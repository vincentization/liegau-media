// Optionales gemeinsames Cloud-Archiv (Supabase, kostenloser Tarif).
//
// Leer lassen = jedes Gerät speichert sein eigenes Archiv lokal (IndexedDB).
// Ausfüllen = das ganze Vereins-Team sieht nach Anmeldung mit dem Vereins-Login dasselbe Archiv.
// Anleitung: README.md → „Gemeinsames Cloud-Archiv (optional)“.
//
// Beide Werte stehen im Supabase-Dashboard unter Project Settings → API.
// Der „anon public“-Key darf öffentlich sein: Ohne Anmeldung erlauben die
// Row-Level-Security-Regeln (supabase/setup.sql) weder Lesen noch Schreiben.
// NIEMALS den „service_role“-Key hier eintragen!

export const SUPABASE_URL = '';      // z. B. 'https://abcdefghijkl.supabase.co'
export const SUPABASE_ANON_KEY = ''; // z. B. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…'
