-- Explicit least-privilege grants. Authenticated anonymous users have the same
-- SQL role as permanent users; auth.uid() RLS remains the ownership boundary.
revoke all on public.profiles, public.model_state, public.events from anon;
revoke all on public.profiles, public.model_state, public.events from authenticated;
grant select, insert, update, delete on public.profiles, public.model_state to authenticated;
grant select, insert, delete on public.events to authenticated;
grant usage, select on sequence public.events_id_seq to authenticated;

-- Use uncompressed serialized size: pg_column_size alone can accept very large,
-- highly compressible strings after TOAST compression.
alter table public.model_state drop constraint if exists model_payload_size_chk;
alter table public.model_state add constraint model_payload_size_chk check (octet_length(model::text) <= 65536);
alter table public.model_state drop constraint if exists model_observations_chk;
alter table public.model_state add constraint model_observations_chk check (observations is not null and observations between 0 and 30000);
alter table public.model_state drop constraint if exists model_history_chk;
alter table public.model_state add constraint model_history_chk check (
  case when model ? 'history' then
    case when jsonb_typeof(model->'history') = 'array' then jsonb_array_length(model->'history') <= 80 else false end
  else true end
);
-- Reject impersonation rather than silently rewriting an explicitly false owner.
create or replace function public.set_row_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if tg_table_name = 'profiles' then
    if new.id is distinct from auth.uid() then raise exception 'Invalid owner'; end if;
  else
    if new.user_id is distinct from auth.uid() then raise exception 'Invalid owner'; end if;
  end if;
  if tg_op = 'INSERT' then
    begin new.created_at := now(); exception when undefined_column then null; end;
  end if;
  begin new.updated_at := now(); exception when undefined_column then null; end;
  return new;
end $$;
revoke execute on function public.set_row_owner() from public, anon, authenticated;
revoke execute on function public.throttle_events() from public, anon, authenticated;

-- Validate only the small numeric learning surface; tolerate omitted legacy
-- fields so existing snapshots can migrate through normalizeModel().
create or replace function public.layer_model_numbers_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text; r jsonb; f jsonb;
begin
  foreach k in array array['cold','mild','warm'] loop
    r := value->'regime'->k;
    if r ? 'off' and (jsonb_typeof(r->'off') <> 'number' or (r->>'off')::numeric not between -15 and 15) then return false; end if;
    if r ? 'n' and (jsonb_typeof(r->'n') <> 'number' or (r->>'n')::numeric not between 0 and 10000) then return false; end if;
  end loop;
  foreach k in array array['wind','wet','sun'] loop
    f := value->'factors'->k;
    if f is not null and (jsonb_typeof(f) <> 'number' or (f::text)::numeric not between -7 and 7) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
alter table public.model_state drop constraint if exists model_numbers_chk;
alter table public.model_state add constraint model_numbers_chk check (public.layer_model_numbers_valid(model));
