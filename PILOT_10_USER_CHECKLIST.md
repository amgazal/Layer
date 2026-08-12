# Layer 10-user pilot checklist

## Before sharing

1. Push this project and wait for the GitHub Actions deployment to turn green.
2. In Supabase → Authentication → URL Configuration, set:
   - Site URL: `https://amgazal.github.io/Layer/`
   - Redirect URL: `https://amgazal.github.io/Layer/auth-callback.html`
3. Open Layer in a private tab and request an email link. Confirm the dedicated **Check your email** screen appears.
4. Keep the original Layer tab open, then open the email link on the same device/browser.
5. Confirm the original Layer tab receives the sign-in when the browser allows it, and that a visible success message appears. If the browser opens a separate context, confirm the new-tab fallback still signs in successfully.
6. Sign out or use a second private browser, return to onboarding, choose **Sign in**, and confirm a saved account restores without re-answering setup.
7. Test the page on one iPhone and one Android device by scrolling vertically and
   swiping slightly sideways; the page should not move horizontally.
8. Confirm a 69° → 69° display has no warmer/cooler badge.
9. During clear, partly-cloudy, and evening conditions, confirm the new Cornell photographs match the reported condition and keep text readable.

## During the pilot

Ask testers to report:
- device and browser
- whether weather matched what they saw outside
- whether the clothing recommendation was understandable
- whether email sign-in returned successfully
- any horizontal movement or frozen background video
