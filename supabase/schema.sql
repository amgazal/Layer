-- ============================================================================
-- Layer — database schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: everything is guarded with "if not exists" / "or replace".
-- ============================================================================

-- UUID generation is used to backfill idempotency keys on older installs.
create extension if not exists pgcrypto;

-- 1) PROFILES ---------------------------------------------------------------
-- One row per user. Onboarding answers + whether they've upgraded from anon.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  climate       text,          -- tropical | temperate | cold
  tolerance     text,          -- colder | same | warmer
  is_anonymous  boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 2) MODEL_STATE ------------------------------------------------------------
-- One row per user: the live calibration model as JSON, mirrored from the
-- client. `observations` is the total kernel weight, used to decide which
-- copy is "richer" when merging a device with the cloud.
create table if not exists public.model_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  model         jsonb not null,
  observations  real default 0,
  updated_at    timestamptz default now()
);

-- 3) EVENTS -----------------------------------------------------------------
-- Append-only feedback log. This is the research dataset the study reads.
create table if not exists public.events (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_event_id uuid not null,          -- idempotency key from the client
  created_at      timestamptz default now(),
  -- conditions at the moment of the outing
  apparent      int,
  effective     int,
  actual        int,
  wind          int,
  precip        int,
  condition     text,
  weather_code  int,
  is_day        boolean,
  -- what the user was doing
  activity      text,          -- waiting | walking | dashing
  start_offset  int,           -- hours ahead the outing was planned
  duration      int,           -- minutes outside
  cycling       boolean,
  band          text,          -- which outfit band was shown
  -- the outcome
  followed      text,          -- yes | mostly | no
  outcome       text,          -- right | cold | warm
  blame         text           -- cold | wind | wet | sun | null
);

create index if not exists events_user_time_idx
  on public.events (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Migration for anyone who ran the FIRST version of this schema (no
-- client_event_id, no checks). Safe to run on a fresh database too.
-- The column must exist and be backfilled BEFORE its unique index is created.
-- ---------------------------------------------------------------------------
alter table public.events add column if not exists client_event_id uuid;
update public.events
set client_event_id = gen_random_uuid()
where client_event_id is null;
alter table public.events alter column client_event_id set not null;

-- Idempotency: an event can be uploaded more than once (retry after a flaky
-- network) but must never create a duplicate row.
create unique index if not exists events_client_event_id_key
  on public.events (client_event_id);

do $$
begin
  -- validation constraints: RLS proves ownership, these prove the data is sane.
  if not exists (select 1 from pg_constraint where conname = 'events_activity_chk') then
    alter table public.events add constraint events_activity_chk
      check (activity is null or activity in ('waiting','walking','dashing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_followed_chk') then
    alter table public.events add constraint events_followed_chk
      check (followed is null or followed in ('yes','mostly','no'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_outcome_chk') then
    alter table public.events add constraint events_outcome_chk
      check (outcome is null or outcome in ('right','cold','warm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_blame_chk') then
    alter table public.events add constraint events_blame_chk
      check (blame is null or blame in ('cold','wind','wet','sun'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_band_chk') then
    alter table public.events add constraint events_band_chk
      check (band is null or band in ('hot','warm','mild','cool','chilly','cold','veryCold','frigid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_duration_chk') then
    alter table public.events add constraint events_duration_chk
      check (duration is null or duration between 1 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_start_offset_chk') then
    alter table public.events add constraint events_start_offset_chk
      check (start_offset is null or start_offset between 0 and 48);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_temp_chk') then
    alter table public.events add constraint events_temp_chk
      check (apparent is null or apparent between -80 and 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_precip_chk') then
    alter table public.events add constraint events_precip_chk
      check (precip is null or precip between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_wind_chk') then
    alter table public.events add constraint events_wind_chk
      check (wind is null or wind between 0 and 250);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_effective_temp_chk') then
    alter table public.events add constraint events_effective_temp_chk
      check (effective is null or effective between -80 and 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_actual_temp_chk') then
    alter table public.events add constraint events_actual_temp_chk
      check (actual is null or actual between -80 and 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_weather_code_chk') then
    alter table public.events add constraint events_weather_code_chk
      check (weather_code is null or weather_code between 0 and 99);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_climate_chk') then
    alter table public.profiles add constraint profiles_climate_chk
      check (climate is null or climate in ('tropical','temperate','cold'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_tolerance_chk') then
    alter table public.profiles add constraint profiles_tolerance_chk
      check (tolerance is null or tolerance in ('colder','same','warmer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'model_observations_chk') then
    alter table public.model_state add constraint model_observations_chk
      check (observations is null or observations >= 0);
  end if;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- With RLS on, the public anon key in the frontend can only ever touch the
-- signed-in user's own rows. This is what makes exposing that key safe.
-- ============================================================================
alter table public.profiles    enable row level security;
alter table public.model_state enable row level security;
alter table public.events      enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own model" on public.model_state;
create policy "own model" on public.model_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own events insert" on public.events;
create policy "own events insert" on public.events
  for insert with check (auth.uid() = user_id);

drop policy if exists "own events select" on public.events;
create policy "own events select" on public.events
  for select using (auth.uid() = user_id);

drop policy if exists "own events delete" on public.events;
create policy "own events delete" on public.events
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- STUDY QUERY — run this in the SQL Editor (it runs as service role there and
-- bypasses RLS, so it sees every participant). This is your résumé number.
--
--   "Just-right rate rose from X% to Y% across N users."
--
-- Per user: just-right rate over their first 5 rated outings vs their last 10,
-- then averaged across users. Outings the user didn't follow are excluded,
-- since those don't reflect the recommendation.
-- ============================================================================
-- with ranked as (
--   select
--     user_id,
--     (outcome = 'right')::int as hit,
--     row_number() over (partition by user_id order by created_at)      as rn_early,
--     row_number() over (partition by user_id order by created_at desc) as rn_recent
--   from public.events
--   where followed <> 'no'
-- ),
-- per_user as (
--   select
--     user_id,
--     avg(hit) filter (where rn_early  <= 5)  as early_rate,
--     avg(hit) filter (where rn_recent <= 10) as recent_rate,
--     count(*) as n
--   from ranked
--   group by user_id
--   having count(*) >= 5            -- only users with enough data to matter
-- )
-- select
--   count(*)                              as users,
--   round(avg(early_rate)::numeric,  3)   as early_just_right,
--   round(avg(recent_rate)::numeric, 3)   as recent_just_right
-- from per_user;
