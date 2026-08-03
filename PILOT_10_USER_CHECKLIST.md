# Layer 10-user pilot checklist

## Before sharing

1. Push this project and wait for the GitHub Actions deployment to turn green.
2. In Supabase → Authentication → URL Configuration, set:
   - Site URL: `https://amgazal.github.io/Layer/`
   - Redirect URL: `https://amgazal.github.io/Layer/auth-callback.html`
3. Open Layer in a private tab and request an email link.
4. Open the link on the same device and browser that requested it.
5. Confirm the profile panel says the profile is synced to the account.
6. Test the page on one iPhone and one Android device by scrolling vertically and
   swiping slightly sideways; the page should not move horizontally.
7. Confirm a 69° → 69° display has no warmer/cooler badge.

## During the pilot

Ask testers to report:
- device and browser
- whether weather matched what they saw outside
- whether the clothing recommendation was understandable
- whether email sign-in returned successfully
- any horizontal movement or frozen background video
