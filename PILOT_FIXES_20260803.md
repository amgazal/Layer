# Pilot fixes — August 3, 2026

- The temperature badge now compares the two numbers visibly shown in the hero.
  If Temperature and For you are both 69°, no cooler/warmer badge is shown.
- The explanation panel now separately names air temperature, official
  feels-like temperature, and Layer's dress-for recommendation.
- Mobile horizontal movement is blocked at the document, app, and touch-gesture
  levels; viewport-width calculations that could exceed the layout were removed.
- Email authentication now returns through `auth-callback.html`, a real GitHub
  Pages file, and a 404 recovery page preserves auth query/hash parameters.
- Vite uses a relative base so one build can run from `/Layer/` or a comparison
  repository without editing asset paths.
