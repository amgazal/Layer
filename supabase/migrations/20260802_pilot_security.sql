-- ============================================================================
-- Layer — pilot security hardening
-- Run once in the Supabase SQL Editor before sharing the app with testers.
-- Safe to re-run.
--
-- Row Level Security already proves WHO owns a row. These additions constrain
-- WHAT a row may contain, so a modified browser client cannot bloat storage,
-- forge ownership, or backdate research data.
-- ============================================================================

-- 1) Bound the calibration payload ------------------------------------------
-- model_state.model is free-form jsonb written straight from the client. A
-- tampered client could store megabytes per user. The real model is well under
-- 16 KB, so cap it generously and reject anything larger.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'model_payload_size_chk') then
    alter table public.model_state add constraint model_payload_size_chk
      check (pg_column_size(model) <= 65536);
  end if;

  -- The model must be a JSON object, not a scalar or array.
  if not exists (select 1 from pg_constraint where conname = 'model_payload_shape_chk') then
    alter table public.model_state add constraint model_payload_shape_chk
      check (jsonb_typeof(model) = 'object');
  end if;

  -- Bound free-text-ish columns on events so no oversized strings land.
  if not exists (select 1 from pg_constraint where conname = 'events_condition_len_chk') then
    alter table public.events add constraint events_condition_len_chk
      check (condition is null or char_length(condition) <= 64);
  end if;
end $$;

-- 2) Server-authoritative ownership and timestamps ---------------------------
-- RLS blocks writing another user's row, but the client still *sends* user_id
-- and updated_at. Deriving them on the server removes the client's say entirely
-- and keeps research timestamps trustworthy (no backdated or future events).
create or replace function public.set_row_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    new.id := auth.uid();
  else
    new.user_id := auth.uid();
  end if;

  if tg_op = 'INSERT' then
    -- created_at is the server's clock, never the device's.
    begin
      new.created_at := now();
    exception when undefined_column then
      null; -- table has no created_at (model_state)
    end;
  end if;

  begin
    new.updated_at := now();
  exception when undefined_column then
    null; -- events has no updated_at
  end;

  return new;
end $$;

drop trigger if exists set_owner_profiles on public.profiles;
create trigger set_owner_profiles
  before insert or update on public.profiles
  for each row execute function public.set_row_owner();

drop trigger if exists set_owner_model_state on public.model_state;
create trigger set_owner_model_state
  before insert or update on public.model_state
  for each row execute function public.set_row_owner();

drop trigger if exists set_owner_events on public.events;
create trigger set_owner_events
  before insert on public.events
  for each row execute function public.set_row_owner();

-- 3) Events are append-only --------------------------------------------------
-- Research rows may be inserted, read, and deleted (privacy reset), but never
-- edited after the fact. There is no UPDATE policy, so this is belt-and-braces.
drop policy if exists "own events update" on public.events;

-- 4) Per-user insert throttle ------------------------------------------------
-- A runaway loop or a malicious client could otherwise flood the table. Real
-- usage is a handful of ratings per day; 200/hour is far above that and far
-- below anything that would hurt.
create or replace function public.throttle_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.events
  where user_id = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent_count >= 200 then
    raise exception 'Too many events submitted in the past hour';
  end if;

  return new;
end $$;

drop trigger if exists throttle_events_insert on public.events;
create trigger throttle_events_insert
  before insert on public.events
  for each row execute function public.throttle_events();

-- 5) Confirm the security posture -------------------------------------------
-- Every table must have RLS enabled. This query should return three rows, all
-- with rowsecurity = true. If any row is false, stop and fix before shipping.
--
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--     and tablename in ('profiles','model_state','events');
