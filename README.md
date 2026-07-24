# Layer — Weather You Can Wear

Layer is a Cornell campus-focused weather application that converts forecast data into personalized comfort and clothing recommendations.

## Live scenic backgrounds

The background is selected from Open-Meteo's **current live weather code** each time weather is loaded or refreshed:

- `0–2` — clear or partly cloudy → `public/backgrounds/clear.webp`
- `3`, `45`, `48` — overcast or fog → `public/backgrounds/cloudy.webp`
- `51–67`, `80–82`, `95–99` — drizzle, rain, showers, or thunderstorm → `public/backgrounds/rain.webp`
- `71–77`, `85–86` — snow or snow showers → `public/backgrounds/snow.webp`

The outing planner still changes the clothing recommendation for a future departure, but it does not overwrite the live background. This keeps the page visually grounded in what is happening on campus now.

The scene files are preloaded and use `import.meta.env.BASE_URL`, so they work both locally and at `https://amgazal.github.io/weather/`.

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

- The header now shows the device's live local time and updates every 30 seconds.
- “Leaving now” displays the actual current-to-end time window instead of rounded hourly forecast timestamps.
- The app uses current Open-Meteo conditions for an outing beginning now, while still using hourly data for the outing range.
- Personalization is explained briefly by default; technical cold/mild/warm adjustments are available under “View learning details.”

## Recommendation transparency and alert polish

- The clothing card includes a collapsed **Why this outfit?** explanation based on the official feels-like temperature, personal adjustment, selected activity, wind/wet/sun exposure, and outing length.
- Weather-change alerts now state the expected temperature difference and the time it may occur.
- Rain alerts show the peak precipitation probability before the outing ends, and snow receives its own warning.
- Accessibility improvements include visible keyboard focus, larger touch behaviour, reduced-motion support, and a higher-contrast mode.
