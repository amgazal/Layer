# Layer

Layer turns Cornell/Ithaca weather into clothing guidance based on your comfort profile, activity, and the weather expected during your outing.

[Demo](https://amgazal.github.io/Layer/)

## Weather and trust

Layer uses Open-Meteo current, 15-minute, and hourly **modeled forecasts**. The [official API documentation](https://open-meteo.com/en/docs#minutely_15) identifies NOAA HRRR as the North American 15-minute source. Precipitation and rain are preceding-15-minute totals; Layer converts them to hourly-equivalent rates. The separate showers field is not a native HRRR 15-minute variable, so that field is requested only in current data. These are not rain-gauge observations or independent weather providers.

Positive precipitation takes priority over dry weather codes. A second, five-point request checks nearby campus precipitation conservatively. Nearby evidence is labeled **Passing shower around campus**, rather than asserting rain at your exact point. Weak isolated signals are ignored. Short localized showers can still be missed by the model; Layer does not offer radar-level or guaranteed real-time detection.

The header and scenic background describe current conditions, even when planning a later departure. Outfit protection and future warnings cover the selected outing.

- Recent real cached weather can appear immediately while refreshing, with its original timestamp.
- **Updated now / Updated N min ago** describes Layer’s last successful check; **Updating…** appears during requests. A failed check with usable recent weather says **Couldn’t update · Showing recent weather**. One amber **Weather may be outdated** line replaces duplicate warnings when retrieval is over 15 minutes old or provider data is over 30 minutes old (two normal 15-minute intervals).
- Weather older than 24 hours, invalid data, or an uncovered outing window produces **Weather unavailable** with Retry. There is no production sample-weather fallback. The old cache namespace is deliberately ignored because it could contain synthetic data.
- Visible pages refresh every five minutes, or two during precipitation. Focus/pageshow refresh after 90 seconds of age. Requests coalesce, obsolete requests abort, and timeouts include response decoding. Frequent polling cannot improve an unchanged model run.

## Location and condition corrections

Campus is the default. **Use my location** explicitly enables a session-only option using one-shot browser geolocation at each weather lookup, never a location watcher. Fixes must be within approximately 8 km of Cornell and report accuracy within 500 m. Otherwise Layer uses campus weather. A valid fix centers the weather request and four nearby probes; there are still only two weather API requests per refresh.

Outside Ithaca, Layer explicitly shows Cornell campus weather; denied or inaccurate location fixes also fall back to campus. Coordinates exist only while performing that lookup and are sent to Open-Meteo as necessary to obtain weather. They are not saved to local storage, Supabase, feedback events, or analytics. Precise-location forecast responses remain in memory and reset on reload. The browser/OS and weather provider have their own permission and request handling.

**Conditions look wrong?** offers rain, snow, or dry reports. Reports refresh weather, override current presentation/protection for 15 minutes, and never train the comfort model. Feedback in a session with a report is saved without learning or uploading a research event until the report is cleared. No crowdsourcing or third-party analytics is added.

## Outing planning and personalization

Choose 20 minutes, one hour, two hours, or a four-hour planning window (the **4+ hrs** button), plus standing, walking, or mostly sheltered travel. Cycling adjusts wind exposure. Longer trips are not given an arbitrary temperature penalty.

The pure [outing module](src/lib/outing.js) samples the full outing using 15-minute data with hourly fallback. Personal offsets, weather sensitivities, activity, cycling, and daylight apply at each point. A time-weighted colder quartile protects against sustained cold without dressing for one extreme reading. Departure has more influence on shorter trips. Material cooling produces **wear now / bring a layer** advice; warming suggests removable layers. Peak rain, wind/gusts, snow and temperature changes also affect guidance. See [algorithm notes](WEATHER_ACCURACY_NOTES.md).

The [comfort model](src/lib/model.js) blends cold/mild/warm regimes with partial pooling, decaying updates, and bounded adjustments. Mostly-followed ratings have reduced weight; just-right and did-not-follow ratings do not retrain. Weather-factor blame routes most of the update to the named sensitivity. Stored models are normalized and bounded before use. These are explainable product heuristics, not scientifically validated clothing recommendations.

## Local storage and optional accounts

No account is required. Setup, calibration and recent ratings stay on the device. A small feedback streak counts consecutive local calendar days with completed ratings, including ratings that do not retrain the model; it is derived from the bounded history, not an accuracy score. Weather still needs a connection; there is no offline service worker.

Optional Supabase sync queues consented feedback with unique IDs, retries failed delivery, and mirrors model snapshots. Queued events are tied to the account that created them and are not reassigned after sign-in. Legacy unowned queued events are withheld. Anonymous accounts cannot recover a lost browser session; link email or a configured OAuth identity for recovery. Signing into an existing account adopts its model; independently trained histories are not merged. Sign-out keeps local calibration and turns cloud sync off.

Model writes are serialized within a tab. Reset waits for in-flight model/event writes, clears application data, and blocks stale restoration while cleanup is pending. A failed account read offers retry instead of treating the account as empty. Simultaneous independent-device calibration remains snapshot-based, not a conflict-free merge.

RLS restricts profiles, model snapshots and events to their owner, including authenticated anonymous users. Explicit grants remove unauthenticated access and event updates. Database checks bound model size, history length, observations, offsets/factors, profile enums and event values. See [backend setup](BACKEND_SETUP.md) and [account setup](ACCOUNTS_SETUP.md). Hosted deployments must apply the latest migration; local tests do not prove a hosted project's configuration.

## Development and verification

React 19, JavaScript, Vite, Lucide, Open-Meteo, optional Supabase. Use Node 22.12+ in the Node 22 line.

```bash
npm ci
npm run dev
npm audit
npm run verify                 # source checks, unit tests, production build
npx playwright install chromium
npm run test:browser           # intercepted weather; responsive and axe checks
npm run test:production        # run after build; assets at / and /Layer/
```

For isolated real Auth/PostgREST integration, with Docker running:

```bash
npm exec --yes --package=supabase -- supabase start
npm run test:integration       # two users, RLS, bounds, linking, deduplication
npm run test:auth              # real account restoration/retry/sign-out in Chromium
npm run smoke:local            # existing smoke suite against the isolated local stack
npm exec --yes --package=supabase -- supabase stop
```

Local tests use project `layer-verification` and ports 55420–55424. The integration suite removes its application rows; the smoke script prints cleanup SQL. Test Auth users remain until removed separately. These commands never target a hosted project. `npm run smoke` remains available for a separately configured development project through `.env`; it is not part of local verification.

GitHub Actions checks dependencies, units, build and browser behavior. The relative Vite base supports `/` and `/Layer/`; domain migration is out of scope. No production user count or measured accuracy improvement is claimed. See [engineering verification report](ENGINEERING_VERIFICATION.md) for results and remaining checks.

## Attribution

Weather data from [Open-Meteo](https://open-meteo.com/), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Layer adapts the data into personalized outfit guidance. Attribution is also available under Profile & account → About Layer.
