# Auth flicker + planner ordering fix — 2026-08-12

## What the recording showed
Between roughly 12–14 seconds, the existing Layer tab was not merely repainting. The auth handoff intentionally navigated that tab to `auth-callback.html` and then back to the app root. On mobile browsers this produced visible blank/loading states, followed by onboarding while account restoration caught up.

## Fix
- The email callback now sends the one-time PKCE `code` to the already-open Layer tab over a same-origin `BroadcastChannel`, with a `localStorage` event fallback.
- The existing Layer tab calls Supabase `exchangeCodeForSession(code)` in place. It no longer navigates to the callback page and back.
- Layer holds a stable “Loading your saved Layer profile…” state from code receipt through profile restoration, preventing onboarding from flashing between auth and model restoration.
- If an older/interrupted account has a `profiles` row but no `model_state`, Layer rebuilds its initial personalized model from the stored climate/tolerance answers and writes the model back to cloud storage.
- If the original tab is unavailable, the callback tab still falls back to completing sign-in itself.

## Mobile content order
At widths below 980px:
1. Current recommendation / hero
2. Wear this
3. Heading out?
4. What’s the plan?
5. Comfort factors
6. Feedback
7. Personalization

The bike/scooter modifier remains always visible inside `Heading out?`.
