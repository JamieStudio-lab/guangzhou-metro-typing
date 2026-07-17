-- v0.3.2 · all 19 lines playable: widen the scores.mode whitelist.
-- Non-destructive — paste into the Supabase SQL Editor and Run ONCE on the live DB.
-- (setup.sql carries the same list for fresh provisions; never re-run setup.sql on live data.)
-- If the drop errors, find the actual constraint name first:
--   select conname from pg_constraint where conrelid='public.scores'::regclass and contype='c';

alter table public.scores drop constraint scores_mode_check;
alter table public.scores add constraint scores_mode_check check (mode in
  ('l1','l2','l3','l4','l5','l6','l7','l8','l9','l10','l11','l12','l13','l14',
   'l18','l21','l22','lgf','lapm','boss'));
