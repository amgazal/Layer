# Temperature display and profile reset

## Main temperature comparison

The hero now keeps each number distinct:

- **Temperature** when leaving now: the current air temperature.
- **Forecast** when a later departure is selected: the forecast air temperature at that departure time.
- **For you**: Layer's personalised dress-for temperature, still calculated from apparent temperature, weather exposure, activity, outing duration, and the learned model.

The standard apparent/feels-like value remains available in the outfit explanation instead of being duplicated in the hero.

## Reset personalization

The profile panel now includes a confirmed **Reset personalization** action. It clears:

- setup answers and seeded offsets;
- ratings and learned model history;
- pending feedback in the local upload queue;
- the user's profile, model state, and feedback events in Supabase when reachable.

After reset, Layer returns to the two-question setup. A pending-reset marker prevents stale cloud data from restoring the old model if the device is temporarily offline.

The anonymous authentication session itself is retained so a user who chooses cloud sync again does not create unnecessary duplicate auth users. It contains no Layer profile data after the reset.

## Supabase requirement

Existing deployments must run:

`supabase/migrations/20260729_profile_reset.sql`

This adds the RLS policy that lets an authenticated anonymous user delete their own feedback events.
