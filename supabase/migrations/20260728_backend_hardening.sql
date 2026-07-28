-- Layer backend hardening migration
-- Run once in Supabase SQL Editor if you already created the original tables.

create extension if not exists pgcrypto;

alter table public.events add column if not exists client_event_id uuid;
update public.events
set client_event_id = gen_random_uuid()
where client_event_id is null;
alter table public.events alter column client_event_id set not null;

create unique index if not exists events_client_event_id_key
  on public.events (client_event_id);

do $$
begin
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
