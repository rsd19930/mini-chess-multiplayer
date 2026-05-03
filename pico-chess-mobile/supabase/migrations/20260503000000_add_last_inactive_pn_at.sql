-- Add last_inactive_pn_at to public.players for the Block F inactive-user PN throttle.
--
-- Block F sends a "your coins are gathering dust" PN to users whose last match
-- was >3 days ago (or who never played at all), at 12:30–13:30 local. This column
-- gates the per-user "max once per 3 days" cap.
--
-- Safe to apply: ADD COLUMN IF NOT EXISTS is idempotent. NULL default = every
-- existing user is immediately eligible on the first qualifying cron tick.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS last_inactive_pn_at TIMESTAMPTZ;
