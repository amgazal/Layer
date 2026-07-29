-- Layer profile-reset migration
-- Run once in Supabase SQL Editor before using “Reset personalization”.

-- Existing profile and model policies already permit the signed-in user to
-- delete their own rows. Events previously allowed insert/select only, so add
-- an explicit delete policy for privacy-respecting profile resets.
drop policy if exists "own events delete" on public.events;
create policy "own events delete" on public.events
  for delete using (auth.uid() = user_id);
