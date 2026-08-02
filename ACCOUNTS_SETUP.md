# Sign-in setup (email · Google · Cornell · Apple)

Signing in is **optional for testers** and off the critical path: the app works
anonymously, and cloud sync already backs a profile up. Signing in is what lets
that profile move to a **second device**.

## The one idea that makes this safe
When Supabase attaches an identity to an anonymous user, **the user id does not
change**. Every existing `model_state` and `events` row already points at that
id, so saving a profile needs **no data migration** — the account simply becomes
permanent in place.

The app therefore runs two flows through the same buttons:

| Situation | What happens |
|---|---|
| Anonymous, first save | `linkIdentity` / `updateUser` → same id, ratings carry over |
| Second device, account exists | link fails → falls back to `signInWithOAuth` / `signInWithOtp`, then the app **adopts the cloud profile** |

---

## 1. Email links — works immediately, no extra provider setup
Nothing beyond the existing Supabase email configuration is required. Leave
`VITE_AUTH_PROVIDERS` blank and testers still get **Continue with email**.

For the first save, request the email link and open it in the same browser where
the anonymous profile was created. On a second device, request a new link on
that device and open that link there. This keeps the user's intention clear and
avoids relying on a link opened in the wrong browser.

**Authentication → URL Configuration**
- **Site URL**: your deployed URL, e.g. `https://amgazal.github.io/weather/`
- **Redirect URLs**: add that same URL **and** `http://localhost:5173/` for dev

This step is required for every provider, including email. If the redirect URL
does not match exactly, the link bounces the user out.

## 2. Enable identity linking (needed to *save* an anonymous profile)
**Authentication → Providers → (settings) → enable manual linking.**

Without it, `linkIdentity` fails and the app falls back to signing in — which
still works, but the anonymous profile on that device is left behind instead of
being carried into the account.

## 3. Google — free, ~15 minutes
1. Google Cloud Console → new project → **APIs & Services → Credentials**
2. **Create OAuth client ID → Web application**
3. Authorised redirect URI: `https://<your-ref>.supabase.co/auth/v1/callback`
4. Copy the client ID and secret into **Supabase → Authentication → Providers → Google**
5. Set `VITE_AUTH_PROVIDERS=google`

## 4. Cornell — Google with a domain hint
Cornell email runs on Google Workspace, so "Continue with Cornell" is the Google
provider with `hd=cornell.edu` passed through. **No separate provider needed.**

Set `VITE_AUTH_PROVIDERS=google,cornell` (google must be listed too).

> **Honest limitation:** `hd` is a *hint* that pre-selects the Cornell account
> chooser. It is not enforcement — someone could still finish with a personal
> Gmail. That is fine for this pilot. Real enforcement would need either a
> server-side check on the email domain or Cornell NetID SAML, and SAML needs
> Supabase Pro plus approval from Cornell IT.

## 5. Apple — only if you have a paid developer account
Requires the **Apple Developer Program ($99/year)**: a Service ID, a key, and
the return URL `https://<your-ref>.supabase.co/auth/v1/callback`. Configure it
in **Supabase → Authentication → Providers → Apple**, then add `apple` to
`VITE_AUTH_PROVIDERS`.

The button stays hidden until then, so nothing breaks if you skip it.

---

## Deploying the setting
`VITE_AUTH_PROVIDERS` is not a secret. Add it as a **repository variable**
(repo → Settings → Secrets and variables → Actions → **Variables** tab), not a
secret. Leaving it unset ships email-only sign-in, which is a perfectly good
pilot configuration.

## What to verify before shipping
- [ ] Save a profile on your laptop with email; confirm `profiles.is_anonymous`
      flips to `false` in Supabase
- [ ] On the phone, request a new link for the same email and open it there; confirm your ratings appear
- [ ] Confirm the rating count on the phone matches the laptop
- [ ] Sign out; confirm the app keeps working anonymously and the local profile
      is still intact

## Known limitation, stated plainly
If a tester trains a profile anonymously on **two** devices and then signs both
into the same account, one history wins rather than merging. The proper fix is
rebuilding the model from the central `events` log, which belongs with a fuller
accounts feature rather than this pilot.
