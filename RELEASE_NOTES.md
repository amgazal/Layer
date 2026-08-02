# Layer backend final — release notes


## First-impression and account UX pass

- Rebuilt onboarding around one value proposition and a compact three-step preview.
- Replaced generic clear/overcast photos with approved Cornell/Ithaca scenic images.
- Made cloud sync an explicit optional choice that starts off.
- Corrected anonymous-sync wording so it no longer promises recovery after browser data is cleared.
- Removed competing first-run actions; the single primary action is **See my recommendation**.
- Made passwordless account saving and restoration available directly from **Profile & account**, even before cloud sync is enabled.
- Added truthful signed-in versus anonymous profile copy and a small account-status indicator.
- Aligned the Comfort factors scale to its four meter segments and expanded `Medium` instead of using `Mod`.
- Added a branded web app manifest, favicon, and Apple touch icon.
- Restored required Open-Meteo attribution as a compact bottom-of-page footer instead of a first-screen note.
- Added regression coverage for onboarding consent, account availability, truthful copy, and mobile app metadata.


## Frontend fixes merged
- Automatic night mode uses Open-Meteo `is_day`.
- Night scenes are dimmed and desaturated for readability.
- Clothing wording and garment badges are gender-neutral.
- Sun is not applied to the personal model at night.
- The Sun threat row and Sun feedback cause disappear at night.
- Daytime-only sun-protection clothing is removed after sunset.
- Mobile threat meters remain visible.

## Backend fixes
- Cloud sync now requires explicit opt-in; no anonymous account is created before consent.
- Existing users can enable, disable, or retry cloud backup from Personalization.
- A failed anonymous auth attempt can retry without reloading.
- Opting out cancels a pending model upload.
- The outbox removes only events that actually uploaded, avoiding a race that could drop new feedback.
- Existing `client_event_id` values are backfilled and made non-null.
- More database constraints protect research-data quality.
- The incomplete email-account upgrade UI is feature-flagged off until sign-in and model merging are finished.

## Accounts, backgrounds, and first-run (pilot build)
- New photography: dedicated day clear sky, a real **night sky** (previously a
  dimmed daytime photo), and a new overcast scene. All re-encoded to WebP —
  night 15 KB and overcast 13 KB, down from ~250 KB / ~196 KB.
- Sign-in added: email links, Google, "Continue with Cornell" (Google with a
  cornell.edu domain hint), and Apple. Buttons appear only for providers listed
  in `VITE_AUTH_PROVIDERS`, so testers never meet a dead button.
- Fixed `detectSessionInUrl: false`, which would have silently dropped every
  OAuth session on return from a provider. PKCE flow enabled.
- Saving a profile links an identity to the **same** user id, so ratings carry
  over with no migration. On a second device linking fails by design and the
  app falls back to signing in, then adopts the saved cloud profile.
- First run: the rating buttons now sit behind one explicit "I've been outside"
  tap, so a new tester cannot rate before an outing and pollute their model or
  the study data. Added a dismissible three-step explainer and labelled the
  day-one personal shift as coming from setup answers.
- Removed the in-app Open-Meteo credit; attribution retained in README to
  satisfy the CC BY 4.0 licence.
- Removed the superseded `AccountUpgrade` component, which called a function no
  longer imported and would have thrown had its feature flag been enabled.

## Field fixes (from live testing)
- Rain intensity is now read from actual measured rainfall (mm), not just the
  forecast code. A "drizzle" code during a real downpour now reads "Heavy rain"
  and drives the Wet threat to High. Verified against standard rain-rate bands.
- Added a subtle, intensity-scaled animated rain overlay (disabled under
  reduced-motion) so heavy rain looks like rain, not just a label.
- Outing planner reframed around the present outing: it now asks "Heading out?"
  with "How long will you be out?" always visible; planning a later departure is
  a secondary option.
- Duration options extended beyond two hours to "Up to 4 hrs" and "5+ hrs" for
  students and lecturers who are out across lectures, libraries, and labs.

## Before deployment
1. Run `supabase/migrations/20260728_backend_hardening.sql` in Supabase SQL Editor.
2. Confirm anonymous sign-ins are enabled.
3. Confirm GitHub Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exist.
4. Push to `main`; GitHub Actions runs regression checks and the Vite build.

## Weather accuracy hardening (live rain testing)
- Uses Open-Meteo's 15-minute North America forecast data for current rain intensity instead of treating a 15-minute precipitation total as a one-hour rate.
- Reconciles the WMO weather code with the 15-minute rain rate, so a stale drizzle/overcast code can be upgraded when the short-range precipitation signal is stronger.
- Refreshes every 5 minutes normally and every 2 minutes while rain is active; returning to the tab after 90 seconds also refreshes automatically.
- Cached weather paints immediately but no longer prevents a background network refresh.
- Rain animation and background darkness now follow live conditions, not a separately selected future outing.
- The 20-minute outing option now uses 15-minute data when available rather than approximating the whole outing from hourly points.
- Added wind gusts to the internal threat calculation without adding clutter to the main screen.
- Shows a subtle "Updated now / Updated N min ago" status.
- Removed a duplicated onboarding heading found during the merge review.

## Rain wording consistency

- Current-condition labels now describe only the weather at departure.
- Outfit protection considers the full selected outing window.
- Future heavy rain is labelled as developing later instead of being presented as current heavy rain.
- Footer rain advice now matches the current rain intensity.


## Final rain classification fix

- Fixed an ordering bug where WMO code 3 returned `Overcast` before measured rain was checked.
- Moved pure rain classification into `src/lib/weather.js` and added unit tests.
- Added a conservative five-point campus rain probe for highly localised showers.
- Changed the first temperature label from `Forecast` to `Feels like`.
- Improved freshness wording and added required Open-Meteo attribution.
