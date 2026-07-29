# Final rain-detection and UX pass

## Root bug fixed
`decodeWeather` previously returned `Overcast` immediately for WMO code `3`, before
checking the measured precipitation rate. This meant a positive rain signal could
never override an overcast code. Weather classification is now handled by the pure,
unit-tested `src/lib/weather.js` module, where rain evidence is evaluated before dry
cloud labels.

## Local shower fallback
Cornell's campus spans enough area that a narrow shower can be missed by one forecast
grid point. Layer now makes one lightweight multi-coordinate Open-Meteo request across
five nearby campus points. It changes only the rain signal; temperature, wind and the
outing forecast still come from the central campus point.

The fallback is conservative:
- the central campus point wins whenever it detects rain;
- two nearby wet points confirm a campus rain signal;
- one nearby point can only create a light passing-rain signal when intensity or the
  hourly rain probability supports it;
- a weak isolated nearby signal is ignored.

If the fallback is responsible for the result, the live condition reads
`Passing rain around campus` instead of overstating certainty at the exact central
coordinate.

## UX improvements
- `Forecast` is now labelled `Feels like`, matching the value actually shown.
- Freshness reads `Live · updated now`, `Cached · N min old`, or `Offline sample`.
- Weather condition and refresh status use polite live regions for screen readers.
- A small Open-Meteo attribution and recommendation disclaimer appears at the bottom.

## Tests added
`src/lib/weather.test.js` covers:
- measured rain overriding overcast and fog codes;
- dry overcast remaining overcast;
- snow retaining priority;
- latest completed 15-minute precipitation;
- conservative multi-point campus rain consensus.
