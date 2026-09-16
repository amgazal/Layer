# Layer

Layer turns Cornell campus weather into clothing recommendations based on a saved comfort profile. It adjusts for how warm or cold you usually feel, what you plan to do outside, and feedback from previous outings.

[Demo](https://amgazal.github.io/Layer/)

## What it does

A forecast alone does not tell you what to wear for a walk across campus. Layer starts with two questions about your climate background and temperature tolerance, then combines Open-Meteo forecasts with your profile to suggest layers. After an outing, you can rate the recommendation as too cold, just right, or too warm.

## Key features

- Compare air temperature with a personalized **For you** dress-for temperature and see why an outfit was suggested.
- Plan a departure and outing duration, with adjustments for standing, walking, quick trips, and riding a bike or scooter.
- See rain, snow, wind, and temperature-change guidance for the outing, with backgrounds that follow current campus conditions.
- Save personalization on the device without an account, or sign in to restore it on another device when Supabase is configured.
- Review recent ratings and learned adjustments, or reset personalization from **Profile & account**.

## Engineering

- **A feedback model separate from React.** [model.js](src/lib/model.js) blends cold, mild, and warm temperature offsets using Gaussian weights. Corrections shrink as evidence accumulates and stay within fixed bounds. Ratings marked “mostly followed” have less influence; “just right” and “did not follow” are logged without changing the model.
- **Weather signals at different time scales.** The app combines current conditions, 15-minute forecasts, and hourly precipitation probability. [weather.js](src/lib/weather.js) converts precipitation totals into hourly rates and checks rain signals before dry weather codes. A five-point campus request provides a fallback when nearby points report rain.
- **Local storage with optional background sync.** The comfort profile loads from local storage first. With cloud sync enabled, feedback enters a bounded local outbox and uploads with retries and unique event IDs to avoid duplicate rows. Pending resets block restoration of an old cloud profile.
- **Account recovery on a static site.** Supabase handles email links and configured OAuth providers. A real [callback page](public/auth-callback.html) supports GitHub Pages and passes the PKCE code to an open Layer tab through `BroadcastChannel`, with a storage-event fallback.
- **Database ownership and validation.** The [schema](supabase/schema.sql) separates setup answers, model snapshots, and feedback events. Row-level security restricts access by user; migrations add server-assigned ownership and timestamps, payload limits, and an event insert throttle.
- **Checks before deployment.** Vitest covers calibration, weather classification, and temperature-display arithmetic. Source-level regression checks and a production build run alongside the tests in the [GitHub Pages workflow](.github/workflows/deploy.yml).

## Tech stack

- **Frontend:** React 19, JavaScript, CSS, Vite, Lucide icons
- **Weather:** Open-Meteo forecast API
- **Optional backend:** Supabase Auth and PostgreSQL
- **Testing and deployment:** Vitest, Node.js check scripts, GitHub Actions, GitHub Pages

## Running locally

Use Node.js 22.12 or newer in the Node 22 line, matching the major version used in CI.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. No environment file is needed for device-only use; live weather requires an internet connection.

For accounts and cloud sync, follow [Backend setup](BACKEND_SETUP.md) and [Sign-in setup](ACCOUNTS_SETUP.md). Copy `.env.example` to `.env`, supply your Supabase URL and public anon key, and restart Vite. Leave those variables unset to run without Supabase.

```bash
npm run verify    # source regression checks, unit tests, production build
npm run preview   # serve the production build locally
```

`npm run smoke` checks a configured development Supabase project. It requires `.env`, creates test users and rows, and prints cleanup SQL; it is separate from `verify`.

## Scope and limitations

Layer uses fixed Cornell campus coordinates, Fahrenheit, and campus time. Its weather inputs are modelled forecasts, so local conditions can differ. A recent cache can be shown while weather refreshes; when a request fails without a usable cache, the interface shows labelled sample data. There is no service worker for loading the app offline.

Anonymous cloud sync depends on the browser session and cannot recover a lost session. Signing into an existing account restores its saved profile; independently trained device profiles are not merged. The repository includes a [pilot runbook](PILOT_LAUNCH.md), but no published pilot results or measured recommendation-accuracy improvement.

## Attribution

Weather data from [Open-Meteo](https://open-meteo.com/), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Layer adapts the data into personalized outfit guidance. Linked attribution appears in **Profile & account → About Layer**, with the full project attribution retained here.
