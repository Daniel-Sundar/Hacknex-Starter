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
