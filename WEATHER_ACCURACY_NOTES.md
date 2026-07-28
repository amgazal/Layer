# Layer weather accuracy notes

Layer uses Open-Meteo for the forecast and now requests three time resolutions:

- `current` for the current temperature and official feels-like value
- `minutely_15` for short-range rain intensity, weather code, gusts, and outing windows
- `hourly` for precipitation probability and longer-range fallback

## Why this changed

A weather code can lag a fast-forming shower. Also, Open-Meteo's current conditions are based on 15-minute model data, so a precipitation total from that interval should not be compared directly with hourly rain-rate thresholds. Layer now converts a 15-minute total to an hourly-equivalent rate before classifying light, moderate, or heavy rain.

## Refresh policy

- Normal weather: every 5 minutes
- Active rain: every 2 minutes
- Returning to a visible tab after 90 seconds: immediate refresh
- Cache: shown immediately for fast startup, followed by a background refresh

## Important limitation

This is still modelled weather for a point on campus, not a rain gauge or radar pixel at the user's exact location. Fast, highly local thunderstorms can differ from any single provider. A future production version should cross-check severe-weather alerts and optionally let users report that current conditions are wrong.
