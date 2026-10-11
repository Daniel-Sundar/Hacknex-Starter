-- ClearScript tables for Supabase. Paste into Supabase > SQL Editor > New query > Run (once).
-- Only the backend touches these, with the service_role key (it bypasses RLS). RLS is on with no policies,
-- so the public anon key can read or write nothing.

create table if not exists public.readings_cache (
  key        text primary key,          -- sha256 of (step, image, model, settings)
  value      jsonb not null,            -- the model's answer
  created_at timestamptz not null default now()
);

create table if not exists public.writer_words (
  id         bigint generated always as identity primary key,
  writer     text not null,             -- writer profile name, e.g. dr-kumar
  original   text not null default '',  -- what the models read
  answer     text not null,             -- what the person confirmed
  created_at timestamptz not null default now(),
  unique (writer, answer)
);

alter table public.readings_cache enable row level security;
alter table public.writer_words   enable row level security;

-- Sign-in history (added later; safe to run on its own). Each signed-in user reads and writes only their
-- own rows: the browser talks to this table directly with the publishable key, and RLS enforces ownership.
create table if not exists public.history (
  id         text not null,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ts         bigint not null,
  updated    bigint,
  name       text not null default '',
  thumb      text,
  doc_type   text not null default 'note',
  flagged    int not null default 0,
  payload    jsonb not null,
  primary key (user_id, id)
);
alter table public.history enable row level security;
drop policy if exists "own history" on public.history;
create policy "own history" on public.history for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "Auto-expose new tables" is off in this project, so grant access explicitly.
grant usage on schema public to service_role, authenticated;
grant select, insert, update, delete on public.readings_cache, public.writer_words to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on public.history to authenticated;

-- Hardening (added 2026-10-11; safe to run again). Least privilege: the browser roles get nothing on the
-- server-only tables, and one account cannot fill the free database with oversized rows (the app itself
-- refuses results over 2,000,000 characters).
revoke all on public.readings_cache, public.writer_words from anon, authenticated;
revoke all on public.history from anon;
do $$ begin
  alter table public.history add constraint history_payload_size check (length(payload::text) <= 2100000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.history add constraint history_thumb_size check (thumb is null or length(thumb) <= 2100000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.history add constraint history_name_size check (length(name) <= 300 and length(id) <= 100);
exception when duplicate_object then null; end $$;
