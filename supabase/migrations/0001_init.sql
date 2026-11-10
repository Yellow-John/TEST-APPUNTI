-- =========================================================
-- Appunti — schema iniziale (esegui nel SQL editor di Supabase)
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- Quaderni / cartelle ----------
create table if not exists public.notebooks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.notebooks(id) on delete set null,
  name text not null,
  color text,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),       -- orologio del client (last-write-wins)
  server_updated_at timestamptz not null default now(), -- cursore di sincronizzazione
  deleted_at timestamptz
);

-- ---------- Note ----------
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete set null,
  title text not null default '',
  content text not null default '',
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  is_locked boolean not null default false,
  locked_payload text,              -- contenuto cifrato lato client (AES-GCM) quando la nota è bloccata
  source jsonb not null default '{}'::jsonb, -- es. { "type": "photo", "files": ["..."] }
  share_token text unique,
  share_mode text check (share_mode in ('view','edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  fts tsvector generated always as (
    setweight(to_tsvector('italian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('italian', coalesce(content, '')), 'B')
  ) stored
);

create index if not exists notes_user_sync_idx on public.notes (user_id, server_updated_at);
create index if not exists notebooks_user_sync_idx on public.notebooks (user_id, server_updated_at);
create index if not exists notes_fts_idx on public.notes using gin (fts);
create index if not exists notes_tags_idx on public.notes using gin (tags);

-- ---------- Commenti (sulle note condivise) ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  author_name text not null default 'Anonimo',
  quote text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_note_idx on public.comments (note_id, created_at);

-- ---------- Impostazioni utente ----------
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_budget_usd numeric not null default 10,
  confirm_before_ai boolean not null default false,
  pin_salt text,
  pin_check text,
  updated_at timestamptz not null default now()
);

-- ---------- Registro consumi AI ----------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric not null default 0
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at);

-- ---------- Trigger: last-write-wins + cursore server ----------
create or replace function public.lww_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old; -- modifica più vecchia di quella già salvata: ignorata
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists notes_lww on public.notes;
create trigger notes_lww before insert or update on public.notes
  for each row execute function public.lww_guard();
drop trigger if exists notebooks_lww on public.notebooks;
create trigger notebooks_lww before insert or update on public.notebooks
  for each row execute function public.lww_guard();

-- ---------- Row Level Security ----------
alter table public.notebooks enable row level security;
alter table public.notes enable row level security;
alter table public.comments enable row level security;
alter table public.user_settings enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "own notebooks" on public.notebooks;
create policy "own notebooks" on public.notebooks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own comments" on public.comments;
create policy "own comments" on public.comments for all
  using (exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid()));

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own usage read" on public.ai_usage;
create policy "own usage read" on public.ai_usage for select using (user_id = auth.uid());
drop policy if exists "own usage insert" on public.ai_usage;
create policy "own usage insert" on public.ai_usage for insert with check (user_id = auth.uid());

-- ---------- Accesso tramite link di condivisione (senza login) ----------
create or replace function public.get_shared_note(p_token text)
returns table (id uuid, title text, content text, share_mode text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select n.id, n.title, n.content, n.share_mode, n.updated_at
  from public.notes n
  where n.share_token = p_token and n.share_mode is not null
    and n.deleted_at is null and n.is_locked = false;
$$;

create or replace function public.update_shared_note(p_token text, p_content text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notes
     set content = p_content, updated_at = now()
   where share_token = p_token and share_mode = 'edit'
     and deleted_at is null and is_locked = false;
  if not found then raise exception 'Link non valido o in sola lettura'; end if;
end $$;

create or replace function public.list_shared_comments(p_token text)
returns setof public.comments language sql security definer set search_path = public as $$
  select c.* from public.comments c
  join public.notes n on n.id = c.note_id
  where n.share_token = p_token and n.share_mode is not null
  order by c.created_at;
$$;

create or replace function public.add_shared_comment(p_token text, p_author text, p_quote text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_note uuid;
begin
  select id into v_note from public.notes
   where share_token = p_token and share_mode is not null and deleted_at is null;
  if v_note is null then raise exception 'Link non valido'; end if;
  if length(coalesce(p_body,'')) = 0 or length(p_body) > 4000 then raise exception 'Commento non valido'; end if;
  insert into public.comments (note_id, author_name, quote, body)
  values (v_note, left(coalesce(nullif(p_author,''),'Anonimo'), 60), left(p_quote, 500), p_body);
end $$;

grant execute on function public.get_shared_note(text) to anon, authenticated;
grant execute on function public.update_shared_note(text, text) to anon, authenticated;
grant execute on function public.list_shared_comments(text) to anon, authenticated;
grant execute on function public.add_shared_comment(text, text, text, text) to anon, authenticated;

-- ---------- Ricerca full-text (classifica per rilevanza) ----------
create or replace function public.search_notes(p_query text, p_limit int default 20)
returns table (id uuid, title text, snippet text, rank real)
language sql stable security invoker set search_path = public as $$
  select n.id, n.title,
         ts_headline('italian', n.content, to_tsquery('italian', p_query),
                     'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>') as snippet,
         ts_rank(n.fts, to_tsquery('italian', p_query)) as rank
  from public.notes n
  where n.user_id = auth.uid() and n.deleted_at is null and n.is_locked = false
    and n.fts @@ to_tsquery('italian', p_query)
  order by rank desc
  limit p_limit;
$$;

-- ---------- Realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notebooks;
exception when duplicate_object then null; end $$;

-- ---------- Storage (foto, PDF, immagini) ----------
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "own files read" on storage.objects;
create policy "own files read" on storage.objects for select
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files write" on storage.objects;
create policy "own files write" on storage.objects for insert
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files update" on storage.objects;
create policy "own files update" on storage.objects for update
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files delete" on storage.objects;
create policy "own files delete" on storage.objects for delete
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Aggiunte successive (incluse qui per le nuove installazioni) ----------
alter table public.notebooks add column if not exists is_locked boolean not null default false;
