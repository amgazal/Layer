# Account linking and restoration

Layer works without an account. Account controls are available in **Profile & account**, and returning users can sign in directly from onboarding. The earlier rating-triggered `AccountUpgrade` card and its feature flag are no longer used.

## Saving the current profile

For an anonymous cloud session, email linking uses `updateUser({ email })`; OAuth uses `linkIdentity`. Successful linking retains the user ID, so existing model and event rows remain attached to the account. If linking fails, the implementation attempts a normal sign-in.

## Restoring an account

Returning-user sign-in goes directly to email OTP or OAuth without first creating an anonymous session. Permanent sessions enable account sync, and the interface waits while the saved model loads. If the model is missing but stored setup answers exist, Layer rebuilds the initial model from those answers. If neither exists, it uses the local seeded profile or asks the user to finish setup.

Signing into an existing account adopts that account's model. It does not merge independently trained profiles or replay their combined feedback history.

## Implementation

- [src/lib/sync.js](src/lib/sync.js): authentication, identity linking, profile reads, and sync status
- [src/Layer.jsx](src/Layer.jsx): account controls, onboarding sign-in, and model restoration
- [public/auth-callback.html](public/auth-callback.html): static PKCE callback and same-origin tab handoff

For provider configuration and callback URLs, see [Sign-in setup](ACCOUNTS_SETUP.md).
