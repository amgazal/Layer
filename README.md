# Layer — Weather You Can Wear

Layer is a Cornell campus-focused weather application that converts forecast data into personalized comfort and clothing recommendations.


## Current first-impression release

This release uses Cornell/Ithaca-specific clear and overcast scenes and tightens the experience around one path:

1. Complete a two-question, 30-second setup.
2. See the current temperature beside Layer's personalized **For you** value.
3. Choose an activity and outing time.
4. Try the recommendation and rate it afterward.
5. Optionally save the profile with passwordless email or a configured provider.

Cloud sync is optional and off by default. Anonymous cloud sync mirrors the current browser profile; signing in is what makes the profile recoverable on another device. Account, storage, cloud status, learning details, and reset controls live together under **Profile & account**.

The app now includes home-screen metadata and branded icons for a more app-like mobile launch. The detailed design review is in `FIRST_IMPRESSION_UX_REVIEW.md`.


## Live scenic backgrounds

The background is selected from Open-Meteo's **current live weather code** each time weather is loaded or refreshed:

- `0–2` — clear or partly cloudy → `public/backgrounds/clear.webp`
- `3`, `45`, `48` — overcast or fog → `public/backgrounds/cloudy.webp`
- `51–67`, `80–82`, `95–99` — drizzle, rain, showers, or thunderstorm → `public/backgrounds/rain.webp`
- `71–77`, `85–86` — snow or snow showers → `public/backgrounds/snow.webp`

The outing planner still changes the clothing recommendation for a future departure, but it does not overwrite the live background. This keeps the page visually grounded in what is happening on campus now.

The scene files are preloaded and use `import.meta.env.BASE_URL`, so they work both locally and at `https://amgazal.github.io/Layer/`.

## Run locally

```bash
npm install
npm run dev
```

## Deploy

Push the complete project to the `main` branch. The included GitHub Actions workflow builds and deploys the Vite app to GitHub Pages. In **Settings → Pages**, keep the source set to **GitHub Actions**.


## White-screen fix

This version adds explicit loading guards before rendering weather-dependent values. It prevents the initial React render from reading `result.personalShift` before the weather calculation exists.


## Mobile-first hierarchy

On screens below 980px, the interface now renders in this order:

1. Live weather summary and personalized temperature
2. Clothing recommendation
3. Activity selection
4. Future-outing planner
5. Comfort threats, feedback, and calibration

This prevents the clothing/activity cards from appearing above the main weather information on phones.


## Current-time and personalization update

- The header shows the device's live local time, updates every 10 seconds, and refreshes immediately when the app regains focus.
- “Leaving now” displays the actual current-to-end time window instead of rounded hourly forecast timestamps.
- The app uses current Open-Meteo conditions for an outing beginning now, while still using hourly data for the outing range.
- Personalization is explained briefly by default; technical cold/mild/warm adjustments are available under “View learning details.”

## Recommendation transparency and alert polish

- The clothing card includes a collapsed **Why this outfit?** explanation based on the official feels-like temperature, personal adjustment, selected activity, wind/wet/sun exposure, and outing length.
- Weather-change alerts now state the expected temperature difference and the time it may occur.
- Rain alerts show the peak precipitation probability before the outing ends, and snow receives its own warning.
- Accessibility improvements include visible keyboard focus, larger touch behaviour, reduced-motion support, and a higher-contrast mode.


## Mobile comfort-meter fix

This build fixes the comfort-threat level bars on narrow screens. The meter now uses a four-column CSS grid with an explicit full width, so the None / Low / Mod / High segments remain visible on phones. This package is configured for `/Layer/`.


## Night and inclusivity update

- The site now uses Open-Meteo `is_day` data to dim the scenic background automatically at night.
- Sun exposure is always `None` after daylight ends and no longer affects the personal temperature calculation at night.
- Clothing visuals use neutral category badges instead of gender-coded emoji garments.
- Clothing wording has been revised to use category-based, inclusive recommendations.
- Comfort threat meters now show no filled bar for a `None` threat level.


## Final reliability and presentation fixes

- Automatic night mode uses Open-Meteo `is_day` and dims the scenic photography.
- Direct-sun effects are never applied, displayed, or offered as a feedback cause at night.
- Daytime-only sun-protection clothing is removed after sunset.
- Clothing labels and garment markers are gender-neutral.
- Cloud sync is explicit opt-in; a new visitor is not anonymously signed in before choosing.
- Failed authentication can retry without a reload.
- The feedback outbox removes only the batch that actually uploaded, preventing an overlapping event from being lost.
- Optional passwordless account saving is available from the profile panel; the app still works without an account.


## Live rain accuracy

Layer combines current, 15-minute, and hourly Open-Meteo data. The 15-minute feed drives current rain intensity and short outings, while hourly probability supports longer planning. Weather refreshes automatically every five minutes, or every two minutes during active rain.


## Live rain footage

When Layer detects live rain, it replaces the synthetic CSS streaks with a muted looping H.264 rain clip. The static rainy image remains available as a poster and accessibility fallback.


## Final rain-detection hardening

Layer now evaluates measured rain before dry cloud labels, so a positive 15-minute
precipitation signal cannot be hidden by an `Overcast` weather code. A conservative
five-point campus rain probe also catches narrow showers that one forecast grid cell
may miss. Pure weather-classification tests live in `src/lib/weather.test.js`.

The main comparison shows the actual **Temperature** now (or **Forecast** for a later departure) beside Layer’s personalized **For you** value. The standard feels-like temperature remains part of the explanation under **Why this outfit?**. Freshness stays visible beside the outing summary. A compact attribution link sits at the very bottom of the page, away from the first-screen weather experience.

## Attribution

Weather data by [Open-Meteo](https://open-meteo.com/), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The large in-app credit was removed from the profile panel. A compact linked credit remains at the bottom of the app, and full attribution is retained here.
