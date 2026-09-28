# Pilot runbook

This is a plan for a small Cornell campus pilot, not a record of completed testing or adoption.

## Configure and verify

1. Follow [Backend setup](BACKEND_SETUP.md), including all migrations and the row-level security check.
2. Enable anonymous sign-ins and configure email using [Sign-in setup](ACCOUNTS_SETUP.md). The current interface supports accounts; there is no account-upgrade feature flag to enable.
3. Set the local `.env` values and GitHub Actions secrets described in those guides.
4. Run `npm run verify`, then `npm run smoke` against a development Supabase project. The smoke script creates test users and data and prints cleanup SQL.
5. Deploy through the included Pages workflow and run the checks below on the deployed build.

The email callback for the existing deployment is `https://layer.amgazal.com/auth-callback.html`. Allow that URL in Supabase, plus `http://localhost:5173/auth-callback.html` for local testing.

## Device checks

- [ ] Complete onboarding with sync off; confirm personalization persists locally.
- [ ] Enable anonymous sync; confirm a `model_state` row appears in Supabase.
- [ ] Rate an outing with sync enabled; confirm an `events` row appears.
- [ ] Disconnect while the app is open, rate again, reconnect, and check that queued feedback uploads without reopening the app.
- [ ] Close the app after rating and confirm the local calibration survives reopening.
- [ ] Reset personalization; confirm cloud profile and event rows are deleted and the model snapshot is empty.
- [ ] Check text readability in daylight and at night; clear nights should use the night photograph.
- [ ] Save a profile to an account and restore it on a second device.
- [ ] Sign out and confirm the app remains usable with local calibration.

Use the [10-user pilot checklist](PILOT_10_USER_CHECKLIST.md) for additional mobile layout and email-handoff checks. Its title describes a planned cohort, not a verified user count.

## Participant instructions

Ask participants to use Layer for two weeks and rate recommendations after their outings. Explain that ratings marked “did not follow” are recorded but do not update the comfort model.

Participants can keep their profile on the device or opt into cloud sync. Cloud-enabled feedback is stored for analysis. Anonymous use does not require an email; choosing email or provider sign-in adds an account identity. Weather uses campus coordinates by default; optional precise mode sends a one-shot location to Open-Meteo and never stores it in feedback or profiles.

## Check incoming feedback

Run these queries in the Supabase SQL Editor with an administrative role:

```sql
select count(*) as events, count(distinct user_id) as users
from public.events;

select user_id, count(*) as ratings, max(created_at) as last_seen
from public.events
group by user_id
order by last_seen desc;
```

These counts cover uploaded events only. Device-only participants, queued uploads, and deleted histories are not represented fully.

## Analyze the pilot

The commented query at the end of [schema.sql](supabase/schema.sql) compares early and recent “just right” rates for users with at least five eligible ratings. It excludes outings marked “did not follow.” Early and recent windows can overlap, and weather and activity may change between them.

Report the actual sample size and rates, including unchanged or lower rates. Do not describe this comparison alone as proof that the model improved recommendations. The repository contains no completed pilot dataset or results.

## Disable cloud in a new deployment

Remove the two Supabase build secrets and rebuild to serve a device-only app. Existing open tabs and previously downloaded builds may still have the old configuration; redeployment does not revoke database access for those clients.
