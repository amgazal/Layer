# Layer — final language and first-use UX review

## Clearer weather language

- Replaced “Rain may strengthen during the outing” with direct wording such as “Rain could get heavier while you’re out.”
- Replaced “Make the outer layer wind resistant” with “Choose a rain jacket that also blocks the wind” or “A wind-blocking jacket will help.”
- Reworded the outfit explanation to use everyday language instead of technical phrases such as “heat loss” and “wind exposure.”
- Changed the personal adjustment badge from `-5° personal` to a clearer phrase such as `5° cooler for you`.
- Simplified freshness labels to `Updated now`, `Updated 3 min ago`, `Cached 3 min ago`, or `Sample data`.

## Cleaner recommendation hierarchy

- Rainy outfits now provide one weather-appropriate outerwear choice instead of recommending both a generic jacket and a separate rain jacket.
- Outerwear scales with both temperature and rain severity, including waterproof insulated options in cold conditions.
- Sun-protection clothing is removed when the departure condition is not sunny.
- The planning summary now says `Feels like` rather than the abbreviated `Feels`.

## Less clutter on the weather screen

- Removed the Open-Meteo and estimate note from the main content grid, where it could appear near the top on mobile.
- Weather attribution now appears quietly at the bottom of the profile panel.
- The estimate and severe-weather guidance now appears during onboarding, where users first learn how Layer works.

## Better feedback flow

- Changed the feedback heading to `How did the recommendation feel?`.
- Added `Rate it after your outing.` so first-time users understand when to use the controls.
- Replaced `What got you?` with `What affected your comfort?` and shortened the answer choices.

No new Supabase migration or environment variables are required for this update.
