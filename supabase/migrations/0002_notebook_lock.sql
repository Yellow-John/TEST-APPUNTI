-- Blocco dei quaderni con PIN (esegui nel SQL editor di Supabase)
alter table public.notebooks add column if not exists is_locked boolean not null default false;
