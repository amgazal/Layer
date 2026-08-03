# Layer — account, sync, feedback, and attribution clarity

## User-facing changes

- Signing in with email or a configured provider now clearly states that account sync turns on automatically.
- Anonymous cloud sync is named explicitly and distinguished from account sync.
- Signed-in profiles display **Synced to your account** and no longer show a redundant cloud-sync toggle.
- The planner summary uses **Feels like 72°–81°** instead of **Official feels like 72°–81°**.
- Selecting **No** for following a recommendation now receives the neutral confirmation: **Thanks — your feedback was saved.**
- Open-Meteo attribution was removed from the bottom of the weather screen and moved to **Profile & account → About Layer**.
- README attribution and sync explanations were updated to match the interface.

## Storage model

- Device storage: always available and works offline.
- Anonymous cloud sync: mirrors the current browser profile but cannot recover it after the anonymous session is lost.
- Account sync: starts automatically after email/provider sign-in and supports restoring the profile on another device.

## Validation

- Regression checks passed.
- JavaScript syntax checks passed.
- TypeScript parsed the JSX successfully with `--noResolve`.
- `npm ci` could not complete in the execution environment because its package mirror returned a 404 for `yallist@3.1.1`; GitHub Actions should run the clean dependency install, unit tests, and Vite production build.
