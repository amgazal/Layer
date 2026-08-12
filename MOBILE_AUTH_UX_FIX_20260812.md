# Layer mobile auth + layout polish — 2026-08-12

## What changed

- Replaced the fragile **Close this tab** auth action with a deterministic **Return to Layer** flow.
- After the original Layer tab completes the PKCE exchange, the callback shows a short success state and returns the callback tab to a clean Layer URL. The already-used auth code is removed before that return.
- If the original tab is unavailable, the callback preserves the code and lets the current tab finish sign-in instead.
- Hardened onboarding/mobile sizing against horizontal drift on iOS Safari:
  - mobile onboarding shell uses auto width rather than an explicit 100% width plus padding;
  - safe-area-aware left/right padding;
  - explicit border-box/min-width constraints on the onboarding card and children;
  - page-level horizontal overflow is hidden;
  - stale horizontal scroll offsets are clamped on page show/orientation changes.
- Renamed the comfort factor **Wet weather** to **Rain & dampness**, or **Snow & dampness** during snow.

## Expected email flow

1. User enters email in Layer.
2. Layer shows the Check your email screen.
3. User taps the magic link.
4. The callback passes the one-time PKCE code to the open Layer tab when available.
5. Callback displays **You're signed in** briefly.
6. Callback returns to Layer instead of attempting to close the browser tab.
7. The original Layer tab is also signed in because the Supabase session is shared on the same origin.

## Validation

- `npm run check:regressions` passes all checks.
- `node --check` passes for edited JavaScript modules and regression script.
- TypeScript successfully parses `src/Layer.jsx` with JSX enabled and no emit.
