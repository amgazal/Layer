# Hosted release verification — pending

The deployed public configuration identifies project `jplgwvyyhppnxuvqcari`.
Confirm it is the intended project before obtaining management access. Do not
paste credentials into chat or commit them. Authenticate the Supabase CLI locally
or use the project's dashboard SQL Editor. Public browser configuration cannot
prove the migration ledger, schema, grants, or Auth redirect allowlist.

## Migration plan

1. Read the hosted migration ledger and export the current schema, policies,
   grants, triggers and functions. SQL Editor installations may have no migration
   ledger: an absent ledger does not mean an absent schema. Compare definitions,
   not only migration names. Do not run a blind `db push` or baseline import.
2. Compare with `supabase/schema.sql` and all five files in
   `supabase/migrations/`. The `20260727_initial.sql` baseline mirrors schema.sql;
   do not apply it over an existing installation merely to populate history.
3. Identify the exact missing changes. In order, the migrations cover backend
   constraints/deduplication, event deletion for reset, ownership/throttle/payload
   restrictions, and final grants/model bounds. Record the reviewed list before
   applying any change. **The hosted missing-migration list is currently unknown.**
4. Take a recoverable backup. Before adding each missing constraint or index,
   count violations using its exact predicate against existing rows. Include
   duplicate event IDs, missing owners/auth references, all profile/event enum
   and numeric checks, model object/size/history/observations/numeric limits.
   For the final migration, inspect serialized JSON size >65,536 bytes,
   observations null/outside 0–30,000, history not an array or >80 entries,
   regime offsets outside ±15, counts outside 0–10,000, and factors outside ±7.
   Check JSON types before casting. Do not silently clamp, delete or rewrite
   production snapshots. Any invalid rows need a separately reviewed repair.
5. Apply only the reviewed missing migrations in order, using a transaction
   where appropriate and accounting for validation locks. Abort on violations;
   preserve user data. Reconcile migration history only after comparing actual
   definitions. No hosted migration has been applied during this pass.
6. Repeat catalog inspection. Verify all three tables have RLS; ownership
   policies use `auth.uid()`; unauthenticated `anon` has no table access;
   `authenticated` has profile/model CRUD and event select/insert/delete only;
   event sequence grants are present; owner/timestamp and 200/hour throttle
   triggers exist; trigger functions have restricted execution and fixed search
   paths; final model bounds and profile/event constraints are validated.
7. With two disposable test accounts, check own-row success and cross-user
   profile/model read, insert, update and delete denial in both directions.
   Check spoofed event ownership, unauthenticated access, authenticated-anonymous
   isolation, reset followed by reload, failed-write retry and account-bound sync.
   Use normal user tokens for these assertions, never a service-role browser
   client. Record test IDs privately and clean up only test-owned rows/accounts.

Read-only catalog queries (run only after confirming the project):

```sql
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
-- If the preceding value is non-null:
-- select version, name from supabase_migrations.schema_migrations order by version;
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('profiles','model_state','events');
select * from pg_policies
where schemaname = 'public' and tablename in ('profiles','model_state','events');
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('profiles','model_state','events')
order by table_name, grantee, privilege_type;
select c.relname, k.conname, k.convalidated, pg_get_constraintdef(k.oid)
from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','model_state','events');
select tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('profiles','model_state','events');
select c.relname, pg_get_triggerdef(t.oid) from pg_trigger t
join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
and c.relname in ('profiles','model_state','events');
select p.proname, p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
and p.proname in ('set_row_owner','throttle_events','layer_model_numbers_valid');
select c.relname, c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='events_id_seq';
```

## Production Auth

Public `/auth/v1/settings` returned HTTP 200 during this pass: email and anonymous
users enabled; Google, Apple and all listed external OAuth providers disabled.
GitHub has no `VITE_AUTH_PROVIDERS` repository variable. No OAuth flow is claimed.
These public settings do not expose the Site URL or redirect allowlist.

Verify Site URL `https://layer.amgazal.com/` and allowed redirect
`https://layer.amgazal.com/auth-callback.html` in hosted Auth settings.
Pages reports no custom domain; no future domain needs activation in this pass.
Use a real test email in the production UI, open its link in the same browser,
verify original-tab PKCE handoff and original-tab-closed fallback, then returning
profile restoration without onboarding flash. Verify sign-out and reload.
Email delivery and actual code exchange still require a test account/operator.

## Physical devices — 5–10 minutes each

Run separately on an iPhone with Safari and Android with Chrome. Record device,
OS/browser version and any defect; emulation does not count as a hardware pass.

- Open the production URL; finish onboarding and reload once.
- Choose Use my location. On iPhone test Allow Once; on Android grant the
  available one-time permission. Confirm local weather or a clearly labeled
  campus fallback. Revoke/deny permission and confirm campus remains usable.
- Scroll the whole page and open planner controls. Compare 20 minutes with four
  hours; verify readable reasoning/layers when forecast conditions change.
- Check recommendation layout in portrait and landscape, with no horizontal
  overflow. Submit feedback and confirm it is recorded.
- Open Profile & account. Check form keyboard, focus, scrolling and dismissal.
  Complete a real email sign-in and confirm the correct saved profile returns.
- Background the browser for a minute and return. Check refresh, controls and
  background media; try Retry/Refresh. Temporarily disconnect and verify clear
  cached/stale/unavailable messaging, then reconnect.
- Compare the displayed current condition with what is happening outside.
  Record a discrepancy without assuming modeled weather is an observation at
  your exact location. Check the temporary condition correction if needed.
