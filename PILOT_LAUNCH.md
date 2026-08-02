# Pilot Launch Runbook

Everything needed to go from this repo to 20 testers, in order. Budget about
90 minutes. Do not skip step 5 — it is the go/no-go gate.

---

## 1. Create the Supabase project (~10 min)
1. supabase.com → new project, region near Ithaca (US East).
2. Save the database password somewhere safe.
3. Wait for provisioning to finish.

## 2. Create the tables and security (~10 min)
In **SQL Editor**, run these in order, one at a time:

1. `supabase/schema.sql` — tables, RLS policies, base constraints
2. `supabase/migrations/20260728_backend_hardening.sql` — idempotency + validation
3. `supabase/migrations/20260729_profile_reset.sql` — event delete policy
4. `supabase/migrations/20260802_pilot_security.sql` — **pilot hardening**

Then confirm RLS is on everywhere. This must return three rows, all `true`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','model_state','events');
```

If any row is `false`, stop and fix before continuing.

## 3. Enable anonymous sign-in (~2 min)
**Authentication → Providers → Anonymous sign-ins → enable.**

Without this the app still works, but stays local-only and your study collects
nothing.

Leave email/password disabled. The account-upgrade UI is feature-flagged off
(`ENABLE_ACCOUNT_UPGRADE = false`), which is correct for the pilot.

## 3b. Sign-in (optional, ~5–20 min)
Testers can use Layer anonymously; signing in is what moves a profile to a
**second device**. Email links need only the redirect URLs below and are a
perfectly good pilot configuration.

**Authentication → URL Configuration** (required even for email links):
- **Site URL**: your deployed URL, e.g. `https://amgazal.github.io/weather/`
- **Redirect URLs**: that URL, plus `http://localhost:5173/` for dev

Then **enable manual identity linking** (Authentication → Providers settings) so
an anonymous profile can be *saved* into an account rather than left behind.

Google and Cornell take about 15 more minutes; Apple needs a paid developer
account. Full steps and the honest limits are in **ACCOUNTS_SETUP.md**.

## 4. Wire up the keys (~10 min)
**Project Settings → API**, copy the Project URL and the `anon` `public` key.

Local:
```bash
cp .env.example .env      # paste both values
npm install
npm run verify            # regressions + unit tests + build
```

Deployed: repo → **Settings → Secrets and variables → Actions** → add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as **secrets**, then push to
`main`. If you configured Google/Cornell/Apple, also add `VITE_AUTH_PROVIDERS`
(e.g. `google,cornell`) as a repository **variable** — it is not a secret.

> The anon key is *designed* to ship in frontend code. It is safe **because**
> RLS restricts every user to their own rows. Never put the `service_role` key
> in the app, in the repo, or in a GitHub secret used by the frontend build.

## 5. GO / NO-GO: verify security end to end (~5 min)
```bash
npm run smoke
```

Use a throwaway/dev project if you can. This signs in two anonymous users and
proves the whole security posture:

- anonymous sign-in works
- an event uploads, and a duplicate upload does **not** create a second row
- **user B cannot read user A's rows** (RLS isolation)
- **user B cannot forge a row owned by user A** (ownership trigger)
- oversized (200 KB) and non-object calibration payloads are **rejected**
- stored events **cannot be edited** after the fact
- `created_at` is **server-generated**, not client-supplied
- a user **can delete their own rows** (privacy reset)
- garbage values (`duration = -500`, `activity = "airplane"`) are rejected

**All checks must pass before you send the link.** If any fail, the most likely
cause is a migration that did not run — re-run step 2 and try again.

## 6. Personal shakedown (~20 min, do this the day before)
On your own phone, on the real deployed URL:

- [ ] Complete onboarding; confirm a `model_state` row appears in Supabase
- [ ] Rate one outing; confirm an `events` row appears
- [ ] Turn on airplane mode, rate again, turn wifi back on — the queued event
      should upload on its own within a minute *without* reopening the app
- [ ] Force-quit right after rating, reopen — calibration should be intact
- [ ] Profile → reset personalization → confirm cloud rows are cleared
- [ ] Check it in both a bright room and at night
- [ ] Confirm the night sky background appears after dark (not a dimmed day photo)
- [ ] Save your profile to an account, open it on a second device, and confirm
      your rating count and calibration came across
- [ ] Sign out and confirm the app still works anonymously

## 7. Send it (start of week)
Suggested message to testers:

> This is Layer — it tells you what to actually wear, and learns how weather
> feels to *you* specifically. Two things that make or break it:
> **rate your outfit after you go out** (that is how it learns), and **be honest
> when you didn't follow it** — "No" is genuinely useful data, not a failure.
> It's anonymous: no name, no email, no precise location. Takes 30 seconds to
> set up. Give it about a week before judging the recommendations.

Ask them to use it for **two weeks** and rate whenever they remember.

## 8. Mid-pilot health check (day 3)
```sql
-- Are events actually arriving?
select count(*) as events, count(distinct user_id) as users
from public.events;

-- Who has gone quiet? (nudge them once, gently)
select user_id, count(*) as ratings, max(created_at) as last_seen
from public.events
group by user_id
order by last_seen desc;
```

If `users` is well under 20, the likely cause is people choosing "keep
everything on this device" — which is their right, and their data legitimately
stays out of the study.

## 9. The result (end of pilot)
Run the query at the bottom of `supabase/schema.sql` (uncomment it). It returns
the sentence that goes on your résumé:

> Across N users, the just-right rate rose from X% to Y%.

Outings where the user answered "No" to following the recommendation are
excluded, since those do not reflect the recommendation's accuracy.

---

## Rollback
If something is badly wrong mid-pilot, you do **not** need to take the app down:
remove the two GitHub secrets and re-deploy. The app falls back to local-only,
keeps working for everyone, and stops writing to the database until you fix it.
