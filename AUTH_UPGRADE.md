# Account Upgrade — anonymous → permanent

The goal, unchanged from what we agreed: **never gate the weather behind a
login.** People land, use the app, and train their calibration as an anonymous
user. Only once that personalization is obviously worth protecting do we offer
to save it — as an opt-in "keep your calibration" prompt, never a wall.

The helper code is retained, but the UI is intentionally disabled until sign-in and model merging are complete.

---

## The one idea that makes this clean
When Supabase upgrades an anonymous user, **the `user_id` does not change.**
Every `model_state` and `events` row already references that id, so upgrading
requires **zero data migration** — the account simply becomes permanent in
place, and the same history is now reachable from any device that signs in.

---

## How it behaves
- **Trigger.** The prompt (`AccountUpgrade` in `Layer.jsx`) appears only when
  *all* of these are true:
  - cloud backup is actually working (`cloudStatus() === "active"`),
  - the user is still anonymous,
  - they've given **≥ 4 ratings** (the model is worth saving),
  - they haven't dismissed it before (persisted in `layer:upgrade-dismissed`).
- **Action.** They type an email and tap Save. That calls
  `supabase.auth.updateUser({ email })`, which emails a confirmation link.
- **Confirm.** Clicking the link returns them to the app; Supabase marks the
  user permanent (`is_anonymous = false`). The `onAuthStateChange` handler in
  `sync.js` catches that and flips `profiles.is_anonymous` to false.
- **Non-blocking.** It's a dismissible card in the flow, not a modal. Declining
  costs nothing — they keep syncing anonymously.

## Dashboard configuration (do this once, when you set up email)
1. **Authentication → Providers → Email** — enable it. For the lightest flow,
   turn on "Confirm email"; a magic confirmation link is enough (no password).
2. **Authentication → URL Configuration**
   - **Site URL**: your deployed URL, e.g. `https://<user>.github.io/weather/`
   - **Redirect URLs**: add the same URL (and `http://localhost:5173` for dev)
     so the confirmation link is allowed to return to the app.
3. (Optional) **Authentication → Email Templates** — reword the confirm email
   to say "Confirm your email to save your Layer calibration."

Until email is configured the prompt still won't misbehave: it only renders
when cloud is `active`, and a failed `updateUser` surfaces a small inline error
rather than breaking anything.

## Edge cases handled
- **Cloud off / device-only.** Prompt never shows; `upgradeWithEmail` refuses.
- **Bad email.** Inline validation before any network call.
- **Email already in use.** Supabase returns an error; shown inline. (Merging
  two histories is deliberately *not* attempted — see below.)
- **Offline at submit.** Error surfaced; nothing is lost, they can retry.
- **Dismissed.** Remembered, so it doesn't nag.

## Deliberately deferred
- **Merging two real accounts.** If someone trained anonymously on two devices
  and then signs the second into an existing account, one history wins — the
  same limitation noted in `BACKEND_SETUP.md`. The proper fix (rebuild the model
  from the central `events` log) belongs with a fuller accounts feature, not
  this MVP.
- **OAuth ("Continue with Google").** `supabase.auth.linkIdentity({ provider:
  "google" })` slots into the same `upgradeWithEmail` seam later; email-link is
  the lowest-friction start.

## Where it lives in the code
- `src/lib/sync.js` — `subscribeAuth`, `currentAuth`, `upgradeWithEmail`, and
  the `onAuthStateChange` handler that maintains anonymous/permanent status and
  updates the profile on upgrade.
- `src/Layer.jsx` — the `AccountUpgrade` component and its single mount point
  under the Personalization card.


## Current release decision

Keep `ENABLE_ACCOUNT_UPGRADE` set to `false`. Supabase supports linking an
email identity to an anonymous user, but a production-quality feature also
needs a way to sign in on another device and reconcile two independently
trained local models. Enabling the prompt before those pieces exist would
promise more than the interface can currently deliver.
