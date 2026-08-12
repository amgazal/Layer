# Returning-user sign-in and ride-control fix — 2026-08-12

## Returning-user authentication

The onboarding sign-in path now authenticates directly against the permanent account. It no longer enables anonymous cloud sync or creates an anonymous Supabase user before starting email/OAuth sign-in.

This removes the auth/onboarding state flicker and prevents a temporary anonymous profile from being reconciled before the permanent account arrives.

Layer now keeps an explicit `checking` auth state during Supabase session initialization. When a permanent session is detected, the app shows `Loading your saved Layer profile…` until cloud reconciliation finishes instead of flashing onboarding.

Returning-user email sign-in still uses `shouldCreateUser: false`, so the sign-in entry does not create a new account for a mistyped or unused email. Error handling is now specific: rate-limit/network errors are no longer incorrectly rewritten as “account not found.”

After authentication:

- if a seeded Layer model exists, it is restored immediately;
- if the device already has a seeded local model, that model is attached to the account;
- if an authenticated account has no saved Layer model, onboarding remains open with a clear explanation instead of showing an error.

## Bike / scooter trip modifier

The `Bike or scooter` modifier is now always visible in the `Heading out?` card, directly below outing duration. It applies whether the user is leaving now or planning a later departure.

The control copy is now:

- **Bike or scooter**
- `Adjust for extra wind while riding.`

The later-time expander now contains only departure-time choices.

## Verification

- Custom regression suite: passed.
- JavaScript syntax checks: passed.
- `Layer.jsx` TypeScript parser check: passed.
- A clean dependency install could not be completed in the execution environment, so the GitHub Actions build remains the final clean-install/build verification.
