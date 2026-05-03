-- Add avatar_url to public.players + populate it in handle_new_user trigger.
--
-- Why: GameScreen wants to display the OPPONENT's avatar next to their username.
-- auth.users.user_metadata.avatar_url is only readable for the current user (RLS),
-- so opponent avatars need to live on public.players where everyone can SELECT.
--
-- Safe to apply: ADD COLUMN IF NOT EXISTS is idempotent. Trigger replacement is
-- idempotent. Backfill is one-time and skips already-stamped rows.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Update the auth trigger to also stamp avatar_url at signup time.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  bonus_amount INT;
BEGIN
  SELECT new_user_bonus INTO bonus_amount FROM public.economy_config WHERE id = 1;

  INSERT INTO public.players (id, username, avatar_url, rating, coins)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Player_' || substr(NEW.id::text, 1, 6)),
    NEW.raw_user_meta_data->>'avatar_url',
    1200,
    bonus_amount
  );

  INSERT INTO public.coin_ledger (player_id, amount, type)
  VALUES (NEW.id, bonus_amount, 'new_user_bonus');

  RETURN NEW;
END;
$function$
;

-- Backfill avatar_url for existing players from auth.users.
-- Skips rows already stamped (idempotent on re-run).
UPDATE public.players p
SET avatar_url = au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
WHERE p.id = au.id
  AND p.avatar_url IS NULL
  AND au.raw_user_meta_data->>'avatar_url' IS NOT NULL;
