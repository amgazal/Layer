# Final rain-detection and UX pass

## Root bug fixed
`decodeWeather` previously returned `Overcast` immediately for WMO code `3`, before
checking the modelled precipitation rate. This meant a positive rain signal could
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
- one nearby point can trigger the nearby-rain fallback when intensity or hourly rain
  probability supports it; its precipitation rate still feeds the final classifier;
- a weak isolated nearby signal is ignored.

If a single nearby point triggers the fallback, the live condition reads
`Passing rain around campus` instead of overstating certainty at the exact central
coordinate.

## UX improvements
- The current interface labels air temperature as `Temperature` or `Forecast`, beside
  the personalized `For you` value.
- Freshness uses `Updated now`, `Updated N min ago`, cached-age labels, or `Sample data`.
- Weather condition and refresh status use polite live regions for screen readers.
- Linked Open-Meteo attribution appears in **Profile & account → About Layer**.

## Tests added
`src/lib/weather.test.js` covers:
- precipitation rates overriding overcast and fog codes;
- dry overcast remaining overcast;
- snow retaining priority;
- latest completed 15-minute precipitation;
- conservative multi-point campus rain consensus.
