# Weather and outing reasoning

## Source semantics (reviewed September 27, 2026)

[Open-Meteo's official definitions](https://open-meteo.com/en/docs#minutely_15) describe North American 15-minute data as NOAA HRRR. Precipitation/rain are preceding-interval totals, while temperature and weather code are instantaneous. Current weather is also model-derived. Nearby requests sample spatial variation in the same model, not independent corroborating providers.

Current rain uses the current interval plus the latest completed 15-minute interval, never a future one. Old intervals beyond 15 minutes are discarded. Unix seconds avoid browser-timezone and DST ambiguity. Future outing samples use the precipitation interval overlapping that exposure; probability uses the enclosing preceding-hour interval. Rate conversion scales by the actual current interval or by four for a 15-minute total.

Snow/freezing/thunder codes retain their meaning. Positive precipitation outranks dry codes. Two nearby wet points or one stronger signal can support a restrained nearby-shower label. A single nearby signal is capped at light-rain protection. Weak isolated signals at low probability do not change the headline.

## Outing algorithm

`buildOuting()` constructs a start-to-end timeline with 15-minute boundaries and exact endpoints. Instantaneous temperature/wind interpolate within covered data; minutely coverage falls back to hourly only where required. Missing full coverage yields unavailable, not extrapolated invented conditions.

`personalTemperature()` applies the existing pooled regime offset, bounded wind/wet/sun sensitivity, activity adjustment and cycling modifier to each point. Sun sensitivity stops when daylight ends. Apparent temperature already includes modeled ambient effects: extra adjustments represent the user's sensitivity, not another generic wind-chill formula.

`outingTemperature()` uses trapezoidal time weights and the lower temperature quartile. Thus a brief outlier receives only its actual share of exposure. The representative value blends departure with that quartile: 80% departure for 20 minutes, 50% for one hour, 25% for two/four hours. These are transparent comfort heuristics, not physiological precision or learned duration parameters. Steady conditions produce identical temperatures across durations.

For a sustained difference of at least 6°F, longer cooling trips keep a departure outfit and add a carryable later layer. Warming trips retain removable departure insulation. The **For you** number describes representative outing exposure; **Wear this** can therefore be lighter at departure when the card explicitly says to bring a layer. Rain protection uses the whole window even when dry now. Gusts/wind use peak exposure for protection, not departure alone. Snow/freezing codes and warnings remain visible.

## Trust and refresh

No sample weather is generated in production. Cache v8 accepts bounded real payloads and preserves timestamps. The display age uses the last successful check. Retrieval older than 15 minutes or provider current data older than 30 minutes shows one compact stale warning; two provider intervals allow ordinary 15-minute cadence. Beyond 24 hours, weather remains unavailable. Both clocks still constrain trust.

Visible pages refresh every five minutes, two during active precipitation, and on return after 90 seconds. Manual refresh and local reports request immediately; overlapping triggers coalesce. Location-mode changes cancel obsolete work. The 10-second network timeout includes JSON parsing. Hidden pages do not poll. No rapid polling is scheduled simply to repeat the same model run.

Precise mode uses one-shot geolocation per lookup, region/accuracy limits, and memory-only coordinates. A local report overrides presentation for 15 minutes; weather corrections and stale-weather feedback never retrain comfort. Modeled showers can still be missed; exact-location mode cannot create radar-level accuracy.
