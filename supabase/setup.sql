-- SV Liegau Media – gemeinsames Cloud-Archiv
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (kann gefahrlos wiederholt werden).
--
-- Sicherheit: Die Website ist öffentlich, der anon-Key steht im Quelltext.
-- Deshalb darf NUR ein angemeldeter Nutzer (Vereins-Login) lesen, hochladen und löschen.
-- Anonyme Zugriffe sind durch Row Level Security komplett gesperrt.

-- 1) Tabelle für die Metadaten ------------------------------------------------
create table if not exists public.media_items (
  id           text primary key,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('image', 'video', 'logo')),
  format       text not null default '',
  format_label text not null default '',
  title        text not null default '',
  mime         text not null,
  width        integer not null default 0,
  height       integer not null default 0,
  size         bigint  not null default 0,
  meta         jsonb   not null default '{}'::jsonb,
  path         text not null,          -- Datei im Bucket "media"
  thumb_path   text,                   -- Vorschaubild im Bucket "media"
  created_by   uuid default auth.uid()
);

create index if not exists media_items_created_at_idx on public.media_items (created_at desc);

alter table public.media_items enable row level security;

drop policy if exists "media_items_select" on public.media_items;
drop policy if exists "media_items_insert" on public.media_items;
drop policy if exists "media_items_delete" on public.media_items;

create policy "media_items_select" on public.media_items
  for select to authenticated using (true);
create policy "media_items_insert" on public.media_items
  for insert to authenticated with check (true);
create policy "media_items_delete" on public.media_items
  for delete to authenticated using (true);

-- Anonyme Rolle hat auf der Tabelle nichts verloren (zusätzlich zu RLS).
revoke all on public.media_items from anon;

-- 2) Privater Speicher-Bucket für die Dateien ----------------------------------
-- 50 MB pro Datei (Obergrenze im kostenlosen Tarif).
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "media_bucket_select" on storage.objects;
drop policy if exists "media_bucket_insert" on storage.objects;
drop policy if exists "media_bucket_update" on storage.objects;
drop policy if exists "media_bucket_delete" on storage.objects;

create policy "media_bucket_select" on storage.objects
  for select to authenticated using (bucket_id = 'media');
create policy "media_bucket_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
-- "update" wird für upsert (erneutes Hochladen derselben Datei) benötigt.
create policy "media_bucket_update" on storage.objects
  for update to authenticated using (bucket_id = 'media') with check (bucket_id = 'media');
create policy "media_bucket_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'media');
