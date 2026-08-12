# Layer — account return + campus scene update (Aug 12, 2026)

## Email-link experience

- After an email is submitted, Layer now switches to a dedicated **Email sent / Check your email** screen.
- The screen includes a one-tap **Open email app** action and a clear way to correct the email address.
- `auth-callback.html` uses `BroadcastChannel` plus a `storage` event fallback to hand the verification URL back to the original open Layer tab when the browser permits it.
- The original tab finishes the Supabase redirect and shows a visible success notice.
- If the original tab cannot receive the handoff, the callback completes safely in the newly opened tab instead of leaving the user stuck.

Browser/email-app limitation: a website cannot force a browser to focus an already-open tab. The handoff is therefore best-effort, with a safe new-tab fallback.

## Returning users on onboarding

- The onboarding header now exposes **Sign in** beside the Layer brand.
- Returning users can authenticate before answering the two setup questions.
- Email sign-in uses `shouldCreateUser: false`, so an unknown address does not create an empty account that could look like lost data.
- When a saved seeded model is found, the app restores it and exits onboarding automatically.
- If an account exists but has no saved Layer model, the user remains signed in and completes setup once.

## New Cornell photography

Three original photographs supplied by the project author were added:

- `clear-campus.webp` — clear/mainly-clear Cornell scene
- `partly-campus.webp` — partly-cloudy Cornell observatory scene
- `sunset-campus.webp` — daylight evening / sunset scene

Clear scenes remain stable during a single day so refreshing the app does not make the background jump unexpectedly.
