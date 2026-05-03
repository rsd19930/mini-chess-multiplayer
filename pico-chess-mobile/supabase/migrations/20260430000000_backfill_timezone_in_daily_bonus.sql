-- Backfill players.timezone in claim_daily_bonus RPC.
--
-- Some clients fail to stamp players.timezone via the client-side .update()
-- call in HomeScreen (Hermes Intl quirks on certain Android builds, silent
-- 0-row updates, etc). Without timezone, the cron-reminders edge function
-- skips Block C (daily-coin) and Block D (Elo nudge) for that user — direct
-- DAU loss.
--
-- This RPC already accepts client_tz on every Home mount, so it's the
-- perfect place to stamp the column server-side. SECURITY DEFINER means
-- RLS doesn't apply and there is no silent failure path.
--
-- The new UPDATE is gated on `timezone IS NULL` so it's a no-op for users
-- already stamped. Idempotent CREATE OR REPLACE — safe to apply on prod.

CREATE OR REPLACE FUNCTION public.claim_daily_bonus(client_tz text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_player_id UUID;
  v_last_bonus TIMESTAMP WITH TIME ZONE;
  v_bonus_amount INT;
  v_new_balance INT;
BEGIN
  -- 1. Get the authenticated user making the request
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- 1.5. Backfill timezone if it's null. Safe to run every call;
  --      the WHERE clause prevents redundant writes.
  UPDATE public.players
  SET timezone = client_tz
  WHERE id = v_player_id
    AND timezone IS NULL
    AND client_tz IS NOT NULL
    AND client_tz <> '';

  -- 2. Lock the player row to prevent double-tapping exploits
  SELECT last_login_bonus, coins INTO v_last_bonus, v_new_balance
  FROM public.players
  WHERE id = v_player_id
  FOR UPDATE;

  -- 3. Check if they already claimed *today* in their local timezone
  IF v_last_bonus IS NOT NULL THEN
    IF (v_last_bonus AT TIME ZONE client_tz)::date >= (now() AT TIME ZONE client_tz)::date THEN
      RETURN json_build_object('success', false, 'message', 'Already claimed today', 'coins', v_new_balance);
    END IF;
  END IF;

  -- 3.5. NEW CHECK: Did they get a new_user_bonus today?
  IF EXISTS (
    SELECT 1 FROM public.coin_ledger
    WHERE player_id = v_player_id
      AND type = 'new_user_bonus'
      AND (created_at AT TIME ZONE client_tz)::date = (now() AT TIME ZONE client_tz)::date
  ) THEN
    -- Stamp the last_login_bonus so the app doesn't keep checking today
    UPDATE public.players SET last_login_bonus = now() WHERE id = v_player_id;
    RETURN json_build_object('success', false, 'message', 'Welcome bonus received today. Daily bonus starts tomorrow!', 'coins', v_new_balance);
  END IF;

  -- 4. Look up the current bonus amount from your config table
  SELECT daily_login_bonus INTO v_bonus_amount FROM public.economy_config WHERE id = 1;

  -- 5. Give the player the coins.
  UPDATE public.players
  SET coins = COALESCE(coins, 0) + v_bonus_amount,
      last_login_bonus = now()
  WHERE id = v_player_id
  RETURNING coins INTO v_new_balance;

  -- 6. Write the secure receipt into the ledger!
  INSERT INTO public.coin_ledger (player_id, amount, type)
  VALUES (v_player_id, v_bonus_amount, 'daily_login');

  -- 7. Tell the app it worked
  RETURN json_build_object('success', true, 'message', 'Bonus claimed!', 'coins', v_new_balance, 'amount_claimed', v_bonus_amount);
END;
$function$
;
