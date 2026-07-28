# Layer — Backend Setup (Supabase)

The app is **local-first**. Without any of the steps below it runs exactly as
before: weather loads instantly, calibration lives in `localStorage`, no login.
Doing this setup adds a background cloud mirror and — the point of the study —
a shared `events` table you can query across all participants.

Nothing here adds a login gate. After a visitor explicitly chooses cloud
backup during onboarding, the app silently signs them in as an **anonymous**
user and syncs under that ID. Turning anonymous
sessions into real accounts (the "keep your calibration" upsell) is the
*second* weekend task and isn't required for the study to work.

---

## 1. Create the project
1. Go to supabase.com, create a free project. Pick a region near your users.
2. Wait for it to finish provisioning (~2 min).

## 2. Create the tables
1. Open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/schema.sql` and click **Run**.
3. You should see the three tables under **Table Editor**: `profiles`,
   `model_state`, `events` — each with the shield icon showing RLS is on.

## 3. Turn on anonymous sign-in
1. **Authentication → Providers** (or **Sign In / Providers**).
2. Enable **Anonymous sign-ins** and save.
   Without this, the app still works — it just stays local-only, because the
   silent sign-in call will fail and every sync no-ops.

## 4. Get your keys
**Project Settings → API**, copy:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** key → `VITE_SUPABASE_ANON_KEY`

Both are public. They are safe in frontend code *because* RLS restricts every
user to their own rows. Do **not** copy the `service_role` key anywhere near
the app.

## 5. Local development
```bash
cp .env.example .env      # then paste your two values in
npm install
npm run dev
```
Open the browser devtools → Application → Local Storage should still show your
model, and in Supabase → Table Editor you should see a `model_state` row appear
after you answer onboarding.

## 6. Deploy (GitHub Pages)
1. Repo → **Settings → Secrets and variables → Actions → New repository secret**.
   Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. Push to `main`. The workflow injects them at build time.
   (No secrets set? The build still passes and ships the local-only app.)

---

## Running the study number
When your participants have used it for a couple of weeks, open the Supabase
**SQL Editor** and run the query at the bottom of `supabase/schema.sql`
(uncomment it first). The SQL Editor runs as service role and bypasses RLS, so
it sees everyone. It returns:

| users | early_just_right | recent_just_right |
|-------|------------------|-------------------|

That last comparison is your résumé sentence:
*"Across N users, the just-right rate rose from X% to Y% over the study."*

---

## How it fits the existing code (for your own notes)
- `src/lib/supabase.js` — creates the client, or `null` if env vars are absent.
- `src/lib/sync.js` — anonymous auth + `pullModel` / `pushModel` / `pushProfile`
  / `logEvent`. Every function is a safe no-op when cloud is disabled or offline.
- `src/Layer.jsx` — five small hooks into what you already built:
  - load effect pulls the cloud copy and adopts it only if it's *richer*
  - `commit()` mirrors every model change (debounced)
  - `seed()` writes the profile
  - `applyFeedback()` appends one event
- The `storageGet`/`storageSet` shim is untouched — localStorage is still the
  synchronous source of truth; the cloud trails it.

## What this revision added (privacy + reliability)
- **Consent at onboarding.** A short privacy notice, plus a "Use only on this
  device" button. Choosing it stores `layer:cloud-pref = off` and no cloud call
  is ever made — not even anonymous sign-in — while the full app keeps working.
- **Visible sync status.** The Personalization card shows "Cloud backup active",
  "Cloud backup unavailable", or "Saved on this device only", so storage is
  never a mystery.
- **Durable events (outbox).** Feedback is written to a local outbox first, then
  uploaded; anything that doesn't land is retried on the next app open. Each
  event carries a `client_event_id`, and the upload uses
  `upsert(..., { ignoreDuplicates: true })`, so a retry can never double-insert.
- **Database validation.** `schema.sql` now adds CHECK constraints (activity,
  followed, outcome, blame, band, duration, start_offset, temperature, precip,
  wind). RLS proves *who* owns a row; these prove the row is *sane* even if a
  modified client tries to post garbage. The schema is safe to re-run — the
  constraints and `client_event_id` are added idempotently for anyone who ran
  the earlier version.

## Known limitation to state plainly
Anonymous identity is tied to the browser. If a participant clears site data
before the app upgrades them to a real account, that anonymous history is
orphaned. That's exactly the risk the future "sign in to keep your calibration"
prompt removes — which makes it an honest upsell rather than a nag.


## Important consent behaviour

A missing `layer:cloud-pref` is treated as device-only. This means opening the
site does not create a Supabase user before the visitor chooses cloud backup.
Existing users who predate the preference can enable backup from the
Personalization card.

## Account upgrade status

The anonymous-to-email helper remains in the code, but its UI is disabled by
`ENABLE_ACCOUNT_UPGRADE = false`. Email linking alone is not a complete
cross-device experience: the product also needs a sign-in screen and a clear
model/event merge policy. Build those together, then enable the flag.
