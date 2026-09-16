# Sign-in setup

Accounts are optional. Device-only profiles stay in local storage; anonymous cloud sync mirrors a browser profile but cannot recover a lost anonymous session. Email or provider sign-in enables account recovery on another device.

Complete [Backend setup](BACKEND_SETUP.md) first.

## Email and callback URLs

Enable the email provider in Supabase Authentication and configure email delivery. Leave `VITE_AUTH_PROVIDERS` blank for email-only sign-in; the frontend shows **Continue with email** whenever Supabase is configured.

In Supabase's authentication URL configuration, use:

| Setting | Value for the existing Pages deployment |
| --- | --- |
| Site URL | `https://amgazal.github.io/Layer/` |
| Allowed redirect URL | `https://amgazal.github.io/Layer/auth-callback.html` |
| Local redirect URL | `http://localhost:5173/auth-callback.html` |

For another deployment or local port, allow its exact `auth-callback.html` URL. The callback is a real static file so GitHub Pages can serve it without route rewrites.

Request and open each email link in the same browser and device so the PKCE verifier is available. The callback attempts to pass the code to the original open Layer tab; if that tab is unavailable, it returns to the app with the code to finish there. It cannot force the browser to focus an existing tab.

## Identity linking

Enable manual identity linking in Supabase Authentication settings. Linking an email or OAuth identity to an anonymous user preserves the user ID and existing rows. See [Supabase's anonymous sign-in guide](https://supabase.com/docs/guides/auth/auth-anonymous) for provider requirements.

| User action | Implementation |
| --- | --- |
| Save an anonymous profile | `updateUser` for email or `linkIdentity` for OAuth |
| Sign in from onboarding | `signInWithOtp` or `signInWithOAuth` |
| Linking fails | Attempt normal sign-in |

The returning-user email path uses `shouldCreateUser: false`. A successful sign-in to an existing account restores its cloud profile; independent local histories are not merged.

## Optional providers

For Google, configure a web OAuth client with the Supabase callback URI `https://<your-ref>.supabase.co/auth/v1/callback`. Enter its client ID and secret in the Supabase Google provider settings, then set `VITE_AUTH_PROVIDERS=google`.

To also show **Continue with Cornell**, use `VITE_AUTH_PROVIDERS=google,cornell`. This uses the Google provider with a `cornell.edu` domain hint. It does not enforce Cornell-only access or provide NetID SSO.

For Apple, configure the Apple provider in Supabase with the required developer credentials and callback, then add `apple` to `VITE_AUTH_PROVIDERS`. Only list providers that have been configured; the variable controls which buttons appear, not provider setup itself.

## Deployment and checks

For GitHub Pages, add `VITE_AUTH_PROVIDERS` as a repository **variable**, alongside the two Supabase repository secrets described in [Backend setup](BACKEND_SETUP.md). Rebuild after changing these values.

Before sharing a configured build:

- Save an anonymous profile with email and confirm the account becomes permanent.
- On a second device, request a new link for the same account and confirm the saved ratings and adjustments load.
- Check the original-tab handoff and the fallback with the original tab closed.
- Confirm returning-user sign-in can restore a profile before onboarding.
- Sign out and confirm local use remains available. The current implementation keeps the local calibration on sign-out.
