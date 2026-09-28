# Layer engineering pass — September 27, 2026

## Focused UX polish — September 28, 2026

This local pass follows the verified release below; it has not been committed or
deployed. No database schema, SMTP, Auth settings, domain, dependencies, rain
thresholds, outing algorithm or learning coefficients changed.

- Display freshness now measures the last successful Layer check: `Updated now`,
  `Updated N min ago`, or `Updating…`. Internal trust independently considers
  retrieval older than 15 minutes and provider current data older than 30 minutes.
  Two expected 15-minute source intervals tolerate ordinary cadence; the 24-hour
  maximum and forecast-coverage requirements are unchanged.
- One compact, opaque amber `Weather may be outdated` status with Refresh replaces
  the duplicate stale paragraph/timestamp. Failed checks with recent usable data
  say `Couldn’t update · Showing recent weather`; unusable data retain
  `Weather unavailable` and Retry. One atomic status region announces freshness.
- Feedback streak derives from completed normalized history entries, by local
  calendar date. Today or yesterday anchors consecutive days; multiple ratings
  count once per day; malformed/future dates are ignored. It appears in the
  feedback section, confirmation and a small profile stat. Just-right and
  not-followed submissions count without changing their no-training contract.
  No separate persistence or animation was added. History remains capped at 80
  entries, so streaks are limited by retained feedback (not lifetime statistics).
- Removed the heuristic `% learned` wording in favor of `Learning from your
  feedback`; the historical ratings display is called a comfort feedback trend.
- Outside-region fixes say `Layer supports the Ithaca area. Showing Cornell campus
  weather.` Denied/inaccurate fixes say `Location unavailable. Using Cornell campus
  weather.` The same region/accuracy limits, coordinate privacy and temporary
  corrections remain in place.
- Browser testing caught and fixed immediate streak visibility when a new rating
  timestamp was newer than the page clock. Extended feedback accessibility testing
  found the existing follow-question label at 4.15:1 contrast; its text was darkened.
  Initial new refresh tests needed to await the first request before gating the
  next; existing checks were retained and the copy-specific assertion updated.

### File-access audit

No intentional filesystem picker, file input, directory enumeration, drag/drop
filesystem access or native filesystem bridge was found in application sources.
The callback uses same-origin BroadcastChannel/localStorage and PKCE exchange;
installed-site metadata does not request filesystem access. The existing Open
email action uses `mailto:` to invoke the user's mail handler, but that alone does
not establish the cause of the reported macOS notification. The optional existing
`window.storage` adapter does not itself request OS file permissions.

No new OS permissions were introduced or recommended. Authentication handoff was
preserved. The security check now flags direct browser file/directory picker calls
in application code, excluding documentation and tests. This static guard is not
an exhaustive analysis of arbitrary dynamic API aliases. The actual macOS warning
cannot be reproduced or attributed without the affected installed-app/browser and
OS context; no physical-device or macOS reproduction pass is claimed.

### Fresh verification results

| Command | Result |
| --- | --- |
| `npm ci` | PASS; 106 installed, 107 audited |
| `npm audit` | PASS; 0 vulnerabilities |
| `npm run verify` | PASS; 79 source checks, 105 unit tests / 6 files, build, credential and filesystem-picker scans |
| `npm run test:browser` | PASS; 23 tests |
| `npm run test:production` | PASS; 2 tests, root and `/Layer/` paths |
| `npm run test:auth` | PASS; 1 real local account test |
| `git diff --check` | PASS |

The existing Layer local Supabase stack was resumed for the account test without
resetting or migrating it. Database integration/smoke checks were not rerun in this
UI-only pass; their earlier results below remain historical.

Browser coverage includes provider ages 9/16/31 minutes, retrieval staleness,
failed refresh, unavailable/retry, one freshness announcement, allowed/denied/
inaccurate/outside location, coordinate storage, streak persistence, non-training
feedback, keyboard navigation and reduced motion. Responsive checks cover
320/375/430/768/1024/1440 px and 844×390 landscape. Stale first-viewport screenshots
were reviewed at 320 and 430 px, along with the normal 375 px layout; no duplicated
warning or horizontal overflow. Axe checks cover the stale and rated states.
Physical Safari/iOS, Android and the reported macOS permission notification remain
manual checks. No new hosted verification or deployment is claimed in this pass.

---

## Final release verification — September 27–28, 2026

**NOT VERIFIED:** hosted migration/schema/security inspection and real production email handoff require management access and a test account. Physical iOS/Android checks also remain pending. No hosted database or domain change was performed.

At the start of this release pass, local and remote `main` were both
`1c46ade9f83abfa0b686c7c0d60759dc6f3a8730`, but 22 tracked files were modified and
three files (including this report) were untracked. That pushed commit's README
still contained obsolete fixed-location/sample-weather wording. All existing
engineering changes were preserved.

**Exact tested release source commit:**
`5e6e094c3936dbaabde6cab0c7f2914fb623baf8`, committed and pushed to `main`.
The full local suite above/below ran against this source tree before committing;
no application, dependency, migration or test code changed afterward. The final
report update is a documentation-only follow-up commit; its own SHA is available
in Git history and the final handoff (a document cannot contain its own commit
hash). This report and the hosted checklist are now tracked.

Both workflows passed for the exact release source SHA:
[Verify Layer, run 36359667374](https://github.com/amgazal/Layer/actions/runs/36359667374)
and [Pages deployment, run 36359660542](https://github.com/amgazal/Layer/actions/runs/36359660542).

### Fresh command results (this pass)

| Command | Result | Count |
| --- | --- | --- |
| `npm ci` | PASS | 106 installed; 107 audited |
| `npm audit` | PASS | 0 vulnerabilities |
| `npm run verify` | PASS | 79 source checks; 86 unit tests / 6 files; build and credential scan |
| `npm run test:browser` | PASS | 16 |
| `npm run test:auth` | PASS | 1, real local Supabase |
| `npm run test:production` | PASS | 2, `/` and `/Layer/` |
| `npm exec --yes --package=supabase -- supabase start` | PASS | local stack resumed |
| `npm run test:integration` | PASS | 29, real local Supabase |
| `npm run smoke:local` | PASS | 15 |
| `git diff --check` | PASS | no whitespace errors |
| `node /tmp/layer-live-release-check.mjs` | PASS | 18 deployed-browser assertions using real Open-Meteo responses |

The temporary live-check harness and logs reside under `/tmp`; this is an ad hoc
release check, not a new repository test script. It observed deployed bundle
`assets/index-7dRW1Lxx.js` and ten HTTP 200 weather responses.

Local SQL inspection confirms all five migration versions are installed:
20260727, 20260728, 20260729, 20260802, 20260927. This pass resumed the existing
isolated test database; it did not rerun the prior pass's `db reset` command.
`schema.sql` and the baseline migration compare byte-for-byte equal.

### Hosted checks and blockers

- Pages identifies `https://amgazal.github.io/Layer/`, workflow deployment, no
  custom domain. Its initial pushed commit's deployment workflow passed:
  [run 36340696114](https://github.com/amgazal/Layer/actions/runs/36340696114).
- Public deployed configuration identifies Supabase project
  `jplgwvyyhppnxuvqcari` with a public publishable key. The fetched production
  bundle contained no scanned private-key, secret-key or service-role JWT
  patterns. This is a targeted inspection, not a universal secret guarantee.
- Public Auth settings returned 200: email and anonymous users enabled; Google,
  Apple and all listed external OAuth providers disabled. No OAuth provider was
  tested or needs a claimed pass. Site URL, redirect allowlist and identity
  linking configuration require management access and are **unverified**.
- `npm exec --yes --package=supabase -- supabase projects list --output json`
  failed with “Access token not provided.” Hosted migration history, actual
  schema, grants, existing-row constraint compatibility and two-user security
  checks are **unverified**. No migration was applied. See the concrete
  [hosted migration plan and device checklist](HOSTED_RELEASE_CHECKLIST.md).
- Real email delivery, PKCE exchange and returning-profile restoration are
  **unverified** without a real test-account login. Local account checks do not
  establish production email behavior.
- Initial real Open-Meteo requests returned 503 and the deployed app displayed
  Weather unavailable with Retry, without synthetic weather. A repeat visit and
  Retry received real 200 main/probe responses and displayed a recommendation.
  The initial failure was transient; no provider or recommendation change was
  made to hide it.
- Final deployed checks passed all 18 assertions: real recommendation load;
  manual refresh increases the cached retrieval timestamp; duration changes
  outing presentation while retaining the current-condition header; granted
  emulated location fetches a real precise forecast; denial simulation falls
  back to campus; test coordinates stay out of local/session storage and the
  app address and are sent only to Open-Meteo; hard reload succeeds; stale and
  expired states work with real cached weather and locally simulated network
  failure; Retry recovers with real responses; all 14 named assets return 200;
  no app asset errors, page exceptions, mixed-content or development requests;
  direct callback access returns to `/Layer/?layer_auth_return=1`.
  The displayed age remained “Updated now” across a quick refresh, correctly
  reflecting the same current provider interval rather than promising newer
  modeled data. Live forecast conditions need not produce a different outfit
  for every duration; deterministic duration/future-rain tests cover that logic.
  Browser permission simulation does not verify a physical OS permission prompt.

### Documentation and privacy review

README now describes real/fresh/cached/stale/unavailable weather, optional precise
location with Cornell fallback, temporary corrections, modeled precipitation,
15-minute/current/hourly inputs, duration/layers, optional local-first sync and
its limits. Corrected one additional mismatch found in this pass: integration
cleans application rows, while smoke prints cleanup SQL and retains test rows;
Auth users remain until separately removed. No new product feature or dependency
change was made during this verification pass.

Precise coordinates are intentionally sent in **Open-Meteo request query URLs**;
the requirement that coordinates appear in no URL whatsoever cannot be claimed.
They are excluded from the application's address, persisted weather cache,
profile/model and feedback payloads. Browser location permissions and provider
request handling still apply. No analytics was introduced. Local reset/race and
malformed-model bounds checks passed; hosted reset remains unverified.

The sections below preserve the engineering-pass implementation history. Their
initial audit findings and original database-reset result are historical, not
additional reruns in this release pass.


## 1. Weather accuracy and trust

- Removed the production synthetic 71°F fallback entirely.
- Added `weather-client.js` for request construction, response validation, cache trust, geolocation limits and temporary corrections. Cache v8 rejects the old potentially synthetic cache namespace.
- Recent cached weather preserves its timestamp. Age considers both retrieval time and the provider's valid time. Beyond 15 minutes, the UI says Last known conditions and warns that the outfit may be outdated. After 24 hours, or without complete usable forecast coverage, the app shows Weather unavailable and Retry.
- Header/scene follow current weather independently of planned departure conditions. Forecast warnings and protection follow the outing.
- Reviewed [official Open-Meteo documentation](https://open-meteo.com/en/docs#minutely_15). Native North American 15-minute precipitation/rain comes from HRRR. Current and nearby requests are modeled signals, not independent providers or observations. The 15-minute showers field is not native HRRR and is no longer requested; current showers remain included.

## 2. Original short-rain failure protections

Preserved precipitation priority over clear/overcast codes, current rainfall components, interval-to-rate conversion, completed-interval timing, five nearby points and faster precipitation refresh. Added dry-code/rain matrix cases, boundaries and DST regression tests, rejection of old completed intervals, and restrained single-nearby intensity. Credible nearby evidence says Passing shower around campus. A small device-only reality check can temporarily report rain, snow or dry conditions when modeled data miss a shower.

No implementation can guarantee detection of every localized ten-minute shower from these modeled inputs.

## 3. Duration and recommendation changes

Extracted `outing.js`: full start/end timeline, native 15-minute sampling, hourly fallback only where necessary, no silent extrapolation beyond coverage. Every point applies the existing personalization, activity, riding and daylight logic.

The representative temperature combines departure with a time-weighted colder quartile. Departure weights are 80%/50%/25% for 20-minute/one-hour/longer outings. These are documented product heuristics. Steady weather gets no duration penalty; a short isolated extreme does not dictate the whole trip. Sustained cooling adds a bring-later layer, while warming retains departure insulation with removable-layer advice. Wind/gust protection considers peak exposure. Future rain can add protection without changing the current header. The four-hour button plans four hours, not an unlimited outing.

Mostly sheltered replaces Quick trip, removing duration contradictions. Why this outfit reflects temperature evolution and the factors actually used.

## 4. Personalization

- Stored offsets clamp to ±15°F; factors to ±7°F; counts to 0–10,000 per regime. Nonfinite values reset safely.
- History is limited to 80 records with normalized allowed fields; unknown data is discarded. Seed logic is pure and tested for all climate/tolerance combinations.
- Preserved regime pooling, shrinking updates, reduced mostly-followed reliability and no learning from did-not-follow/just-right feedback.
- Feedback learning uses representative outing apparent temperature rather than departure alone. No learned duration parameter was introduced.
- Stale weather and sessions with a condition report do not adjust comfort learning or upload a research event. Clearing the report reenables ordinary feedback behavior. Reports expire visually after 15 minutes; the correction session remains excluded from learning until cleared.
- Feedback still refers to the selected recommendation; this pass does not add a trip-history recorder or claim causal/physiological validation.

## 5. Security and privacy

Added `20260927_final_bounds.sql`: explicit grants, no unauthenticated table access, no event updates, serialized model size cap, bounded history length and observation counts, offset/factor validation, and rejection of explicit ownership spoofing. Earlier profile/event constraints and RLS remain.

Real local Auth/PostgREST tests use two distinct accounts in both directions. They verify profile/model/event isolation, update/delete isolation, spoofed feedback rejection, unauthenticated denial, authenticated-anonymous ownership, deduplication, input rejection, and anonymous email linking followed by a new sign-in with preserved data.

Optional precise mode uses one-shot geolocation, an approximately 8 km Ithaca limit and ≤500 m reported accuracy. Coordinates exist only for the lookup, go only to Open-Meteo as necessary, and are excluded from caches, profiles, models and feedback. No location watcher, crowdsourcing, analytics or additional backend was introduced. Campus fallback remains available.

## 6. Reliability fixes

Weather triggers coalesce, obsolete mode-change requests abort, and request timeouts cover decoding. Hidden pages stop polling. React StrictMode mounting no longer leaves the mounted flag false. Invalid/incomplete weather cannot silently become a normal recommendation.

Model writes serialize within a tab. Reset waits for in-flight model/event writes and pending appends. Failed account reads throw instead of masquerading as absent data, and the UI provides restoration retry without onboarding or cloud overwrites. Stale initialization cannot overwrite newly committed local feedback. Sign-out checks returned errors and disables cloud sync on success. Repeated auth focus events no longer repeatedly restore the account. Queued feedback is account-bound; append/flush share a browser lock where supported, and concurrent flushes preserve in-flight events. Legacy unowned queued events are withheld rather than assigned to a new account.

Independent devices still exchange snapshots, not merged histories. Cross-tab locking depends on Web Locks support; older browsers retain the same-tab fallback. Full multi-device conflict resolution was intentionally not added.

## 7. UX, accessibility and performance

Preserved Cornell photography, glass cards, hierarchy and clothing categories. Added restrained trust, unavailable, location and report controls. Fixed low-contrast text/selected chips/onboarding descriptions, profile focus trapping/restoration, keyboard access to the riding checkbox, feedback accessible names/status, and comfort-meter alignment/accessible level labels.

No longer preloads every background. Reduced-motion users do not mount the rain video. Existing compressed media were already small (video about 440 KiB; largest image about 444 KiB), so no quality-reducing re-encoding was needed.

Automated Chromium/axe checks covered main content, profile, onboarding and unavailable states. Viewports: 320, 375, 430, 768, 1024, 1440. Tests check overflow and profile keyboard flows. Desktop/mobile screenshots were visually inspected. These are not physical iPhone/Android or screen-reader-user tests.

## 8–9. Tests and exact command results

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; 106 packages installed, 107 audited, zero vulnerabilities. npm reported unapproved optional install-script notices; the subsequent build succeeded. |
| Initial `npm audit` | Six vulnerabilities: three moderate, two high, one critical. Old Vitest pulled vulnerable development tooling; nanoid also needed a patch. |
| Final `npm audit` | Exit 0; **zero vulnerabilities** after Vitest 4.1.11 and nanoid patch update. No force upgrade used. |
| `npm run verify` | Exit 0; **79 source regression checks, 86 unit tests across six files**, production build and credential-pattern scan passed. |
| `npm run test:browser` | **16 passed**: onboarding, planning/activity, rain now/later, failure/retry, recent/stale cache, calibration persistence, report refresh/expiry, six viewport/accessibility checks, precise/denied location, and coalesced refresh triggers. |
| `npm run test:auth` | **1 passed**, using real local Supabase: failed restoration retry, no onboarding/overwrite, restored model and sign-out. |
| `npm run test:production` | **2 passed**, production assets at `/` and `/Layer/`, including callback, manifest, photos and rain video. |
| `supabase start` and `supabase db reset --local` via npm exec | Exit 0; all five repository migrations applied to the isolated `layer-verification` project. CLI 2.118.0. |
| `npm run test:integration` | **29 passed**, real local Auth/PostgREST with two users and final database constraints. |
| `npm run smoke:local` | Original repository smoke script against local Supabase: **15 passed, zero failed**. |
| `git diff --check` | Exit 0. |

Final device-only production bundle: JS **331.07 kB / 101.34 kB gzip**, CSS **0.43 kB / 0.28 kB gzip**, HTML **1.10 kB / 0.51 kB gzip**. The credential scan checks private-key, Supabase secret-key and service-role JWT patterns; it is not a universal secret-detection guarantee. Build-time public configuration remains in `.env.example`; no private credential was introduced.

Initial npm/Docker/browser runs were blocked by sandbox networking/socket/port restrictions; required commands were rerun with access and succeeded. Early browser runs found contrast and focus defects, which were fixed before the passing results above. The first auth simulation used a retried HTTP 503 and exceeded its assertion timeout; the deterministic failure test now uses an immediate HTTP 400.

## 10. Files changed in this pass

- UI: `src/Layer.jsx`.
- Pure logic and tests: `src/lib/{weather,weather-client,outing,model,sync}.js`, and corresponding `.test.js` files.
- Browser tests: `tests/browser/weather.spec.js`, `tests/auth/account.spec.js`, `tests/deployment/assets.spec.js`.
- Test tooling: `playwright.config.js`, `playwright.auth.config.js`, `playwright.production.config.js`, `scripts/{auth-browser,local-integration,local-smoke,serve-production,security-check,regression-check}.mjs`.
- Database: `supabase/config.toml`, `supabase/.gitignore`, `supabase/migrations/20260727_initial.sql` (baseline mirror of existing schema), `supabase/migrations/20260927_final_bounds.sql`.
- Dependencies/build/CI: `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`, `.github/workflows/{deploy,verify}.yml`.
- Documentation: `README.md`, `WEATHER_ACCURACY_NOTES.md`, `BACKEND_SETUP.md`, `RAIN_DETECTION_FINAL.md`, `FINAL_LANGUAGE_UX_REVIEW.md`, `PILOT_LAUNCH.md`, `RELEASE_NOTES.md`, this report.

## 11–12. Remaining checks and intentional limits

1. **Hosted database:** management access is unavailable. Follow the reviewed comparison/preflight sequence in HOSTED_RELEASE_CHECKLIST.md; do not assume which migrations are missing or apply them blindly. Public provider settings were inspected in the release pass, but schema, grants and redirect settings remain unverified.
2. **Real email/OAuth:** local email identity linking and account UI passed, but real provider redirect, email delivery and original-tab PKCE handoff/fallback across mobile browsers remain unverified. Local browser tests do not establish production provider configuration.
3. **Physical devices:** verify Safari/iOS and Android geolocation permissions, background/resume video behavior and screen-reader interaction. Chromium emulation and screenshots passed; no physical hardware was used.
4. **Forecast limits:** modeled showers can still be missed. Native 15-minute data is not an observation network. No new weather provider, radar, alert infrastructure or accuracy percentage was invented.
5. **Synchronization limits:** independent histories are not merged; simultaneous-device snapshots can conflict. This pass does not replace the backend or introduce many context-specific personalization parameters.
6. **CI:** source/unit/build/browser/production checks are wired into workflows; see the release-pass section above for actual hosted run status. Docker-based account tests remain an explicit local command to avoid making routine Pages deployment depend on a larger service stack.
7. **Scope:** no redesign, LLM, social features, wardrobe database, new domain, analytics, maps, notifications or deployment was added. No claim of scientifically validated clothing advice or completed user-study results is made.
