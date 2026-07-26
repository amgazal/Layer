-- ============================================================================
-- Layer — database schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: everything is guarded with "if not exists" / "or replace".
-- ============================================================================

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
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
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
