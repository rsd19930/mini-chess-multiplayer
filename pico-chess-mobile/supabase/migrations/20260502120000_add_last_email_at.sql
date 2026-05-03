-- Add last_email_at to public.players for the email channel throttle.
--
-- Why: cron-reminders Block E (daily-coin email fallback for users without PN
-- permission) gates on "no email sent in the past 3 days" via this column.
-- One column covers all email types since we cap at 1 email/user/3-days globally.
--
-- Safe to apply: ADD COLUMN IF NOT EXISTS is idempotent. NULL default means
-- existing users are immediately eligible (no email ever sent).

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;
