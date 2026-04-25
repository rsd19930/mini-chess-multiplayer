-- Push notifications: additive schema for server-side daily-coin and Elo-nudge reminders.
-- All changes are nullable column adds + a boolean default; existing data and code paths unaffected.

-- Players: timezone + match-tracking + per-type PN throttles
alter table "public"."players" add column if not exists "timezone" text;
alter table "public"."players" add column if not exists "last_match_played_at" timestamp with time zone;
alter table "public"."players" add column if not exists "last_daily_coin_pn_at" timestamp with time zone;
alter table "public"."players" add column if not exists "last_elo_nudge_pn_at" timestamp with time zone;

-- Matches: per-match dedup flag for the Elo nudge
alter table "public"."matches" add column if not exists "elo_nudge_sent" boolean not null default false;

-- Indexes to keep cron queries cheap as the user base grows
create index if not exists idx_players_last_match_played_at
    on public.players (last_match_played_at)
    where expo_push_token is not null;

create index if not exists idx_matches_elo_nudge_pending
    on public.matches (created_at)
    where status = 'completed' and elo_nudge_sent = false;
