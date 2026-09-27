> The September engineering pass is recorded in [ENGINEERING_VERIFICATION.md](ENGINEERING_VERIFICATION.md); older summaries below describe earlier milestones.

# Release notes

This summary describes the implementation in the current repository. The dated fix notes record earlier changes and may include wording or layouts that have since been replaced. Setup instructions live in [Backend setup](BACKEND_SETUP.md) and [Sign-in setup](ACCOUNTS_SETUP.md).

## Weather and recommendations

- Combines current, 15-minute, and hourly Open-Meteo model data.
- Converts precipitation totals to hourly-equivalent rates before classification and checks precipitation signals before dry weather codes.
- Uses a five-point campus request as a fallback for nearby rain signals.
- Refreshes every five minutes normally, every two minutes during rain, and when returning to a tab with weather older than 90 seconds.
- Shows air temperature beside the personalized dress-for value, with a badge based on the displayed arithmetic.
- Separates conditions at departure from rain, snow, and temperature changes expected during the outing.
- Offers standing, walking, and quick-trip activities, plus a bike/scooter modifier and outing durations of 20 minutes, one hour, two hours, or four hours (labelled “4+ hrs”).

These inputs are modelled weather, not on-campus rain-gauge measurements. Classification tests check code behavior; they do not establish forecast accuracy in the field.

## Personalization and accounts

- Starts with two setup questions and saves calibration locally.
- Requires an explicit choice before anonymous cloud sync.
- Supports email links and configured Google, Cornell-hinted Google, and Apple sign-in.
- Restores the saved account model after sign-in, with setup-answer recovery when the model is missing.
- Queues cloud-enabled feedback with unique event IDs and automatic retries.
- Confirms personalization resets and blocks stale cloud restoration while cleanup is pending.
- Uses a static auth callback with a same-origin tab handoff and a fallback when the original tab is unavailable.

## Interface

- Uses Cornell/Ithaca scenes, a separate clear-night image, and looping rain footage with a static reduced-motion fallback.
- Keeps live backgrounds independent of future departure selections.
- Places the weather summary, clothing, planner, and activity controls in that order on mobile.
- Includes keyboard focus styles, selected-state semantics, and higher-contrast media styles.
- Provides app icons and a web manifest; there is no offline service worker.
- Keeps linked Open-Meteo attribution in **Profile & account → About Layer** and in the README.

## Validation

`npm run verify` runs source-level regression checks, Vitest unit tests, and the Vite build. GitHub Actions runs these checks before deploying to Pages. The separate `npm run smoke` script exercises a configured development database; mobile auth and layout still need browser testing.
