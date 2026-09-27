# Backend setup

Supabase is optional. Without its environment variables, Layer saves the comfort profile in local storage and requests weather directly from Open-Meteo. Configuring Supabase adds account recovery, model sync, and a feedback event log.

## Database

Create a Supabase project, then run these files in the SQL Editor in order:

1. [schema.sql](supabase/schema.sql)
2. [20260728_backend_hardening.sql](supabase/migrations/20260728_backend_hardening.sql)
3. [20260729_profile_reset.sql](supabase/migrations/20260729_profile_reset.sql)
4. [20260802_pilot_security.sql](supabase/migrations/20260802_pilot_security.sql)
5. [20260927_final_bounds.sql](supabase/migrations/20260927_final_bounds.sql)

The schema includes some earlier migration changes; the migration files are written to allow re-running them. The migrations add payload constraints, ownership and timestamp triggers, an event insert throttle, explicit grants, and numeric/history bounds. The latest migration rejects explicit ownership spoofing. Existing invalid snapshots must be repaired before its constraints can be applied. `20260727_initial.sql` is the baseline used by local Supabase; it mirrors schema.sql and is not an extra hosted setup step.

Confirm that this query returns three rows with `rowsecurity = true`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'model_state', 'events');
```

| Table | Contents |
| --- | --- |
| `profiles` | Climate and temperature-tolerance answers, account status |
| `model_state` | Current model as JSON and its observation weight |
| `events` | Weather, activity, recommendation, and feedback for synced outings |

## Authentication and local configuration

Enable anonymous sign-ins in Supabase Authentication. Layer uses an anonymous identity only after the user chooses anonymous sync or begins saving a local profile to an account. Configure email and any OAuth providers using [Sign-in setup](ACCOUNTS_SETUP.md).

With Node.js 22.12+ in the Node 22 line:

```bash
npm ci
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's URL and public anon key, then run `npm run dev`. These values are bundled into the frontend; row-level security controls data access. Never use a `service_role` key in the frontend.

Complete onboarding with anonymous sync selected, then confirm that a `model_state` row appears. A device-only profile does not create that row. Rate an outing with sync enabled to check the `events` table.

## Verification

```bash
npm run verify
npm run smoke
```

`verify` runs local source checks, unit tests, and the Vite build. `smoke` reads `.env` and exercises anonymous authentication, event deduplication, cross-user access, model validation, and event deletion against Supabase. Use a development project: it creates test users and rows. It prints SQL to remove test data; auth users remain until removed separately.

## Deployment

The [Pages workflow](.github/workflows/deploy.yml) runs on pushes to `main` or manual dispatch. Set GitHub Pages to use **GitHub Actions** and configure:

- Repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Optional repository variable: `VITE_AUTH_PROVIDERS`, such as `google,cornell`

The workflow passes these into the build. With both Supabase secrets absent, the app builds in device-only mode. The optional `VITE_AUTH_REDIRECT_URL` override in `.env.example` is not passed by the workflow; the deployed app normally derives its callback from the page URL.

## Sync behavior and limits

[src/lib/sync.js](src/lib/sync.js) mirrors model changes after a short debounce. With sync enabled, feedback is queued locally before upload, deduplicated by `client_event_id`, and retried after failures or when the browser reconnects. The outbox retains up to 200 events, and the model retains up to 80 recent ratings. Feedback created before opting in is not backfilled into `events`, though the model snapshot can include local history.

Ordinary reconciliation compares observation weights; explicit account restoration adopts the saved account model. Independent device histories are not merged. Anonymous sessions cannot be recovered after browser credentials are lost, so users need to link an account for cross-device recovery.

Reset clears local personalization and queued feedback, deletes the current user's cloud profile and events, and writes an empty model snapshot. If cloud cleanup fails, a pending-reset marker prevents old data from being restored before cleanup is retried. Reset does not delete the authentication account.

## Pilot analysis

The commented query at the end of [schema.sql](supabase/schema.sql) compares each eligible user's first five and most recent ten followed-outfit ratings, then averages those rates across users. The windows can overlap for short histories. This is a descriptive comparison, not evidence by itself that personalization caused an improvement. No pilot results are included in the repository.

## Local verification

The isolated `supabase/config.toml` project uses ports 55420–55424. Run `supabase start`, `npm run test:integration`, and `npm run test:auth`. These test real local Auth/PostgREST with distinct users; they do not verify hosted configuration. Read [README](README.md) for full commands and [verification report](ENGINEERING_VERIFICATION.md) for results.
