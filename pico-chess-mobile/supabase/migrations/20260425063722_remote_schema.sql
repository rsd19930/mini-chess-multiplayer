set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.record_match_result(p_match_id uuid, p_winner_id uuid, p_bot_depth integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_match RECORD;
  v_caller_id UUID := auth.uid();
  v_opponent_id UUID;
  v_caller_elo INT;
  v_opponent_elo INT;
  v_k_factor INT := 32;
  v_expected_score FLOAT;
  v_actual_score FLOAT;
  v_elo_delta INT;
  v_new_elo INT;
BEGIN
  -- 1. Lock the match row to prevent concurrent race conditions from both clients executing at exactly the same millisecond
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- 2. Check if Elo is already processed to prevent inflation exploits
  IF v_match.elo_processed = TRUE THEN
    -- If already processed by the other client, we still want to gracefully return the caller's updated Elo state!
    SELECT rating INTO v_caller_elo FROM public.players WHERE id = v_caller_id;
    RETURN jsonb_build_object('elo_change', 0, 'new_elo', v_caller_elo, 'already_processed', true);
  END IF;

  -- 3. Identify Caller and Opponent correctly mapping the Match table
  IF v_match.player_white = v_caller_id THEN
    v_opponent_id := v_match.player_black;
  ELSIF v_match.player_black = v_caller_id THEN
    v_opponent_id := v_match.player_white;
  ELSE
    RAISE EXCEPTION 'Caller is not a participant in this match';
  END IF;

  -- 4. Fetch Caller Elo
  SELECT rating INTO v_caller_elo FROM public.players WHERE id = v_caller_id;

  -- 5. Fetch Opponent Elo dynamically handling PicoBot
  IF v_opponent_id = '00000000-0000-0000-0000-000000000000' THEN
    IF p_bot_depth IS NULL THEN
      -- Default to Medium if undefined
      p_bot_depth := 2;
    END IF;
    SELECT elo INTO v_opponent_elo FROM public.bot_difficulty_elos WHERE depth = p_bot_depth;
  ELSE
    SELECT rating INTO v_opponent_elo FROM public.players WHERE id = v_opponent_id;
  END IF;

  -- 6. Calculate Actual Outcome
  IF p_winner_id = v_caller_id THEN
    v_actual_score := 1.0;
  ELSIF p_winner_id = v_opponent_id THEN
    v_actual_score := 0.0;
  ELSIF p_winner_id IS NULL THEN
    v_actual_score := 0.5; -- Draw
  ELSE
    RAISE EXCEPTION 'Invalid winner_id provided';
  END IF;

  -- 7. Advanced Elo Arithmetic (Expected Score Formula)
  v_expected_score := 1.0 / (1.0 + power(10.0, (v_opponent_elo - v_caller_elo) / 400.0));
  v_elo_delta := round(v_k_factor * (v_actual_score - v_expected_score));

  -- 8. Soft Cap Mitigation (PvE Only): Stop extreme inflation if grinding Easy Bot
  IF v_opponent_id = '00000000-0000-0000-0000-000000000000' THEN
    IF v_actual_score = 1.0 AND v_caller_elo >= 1800 THEN
      v_elo_delta := 0; -- Hard Cap at Expert Tier from Bots
    END IF;
  END IF;

  v_new_elo := v_caller_elo + v_elo_delta;

  -- 9. Persist the New States
  -- Update Caller
  UPDATE public.players SET rating = v_new_elo WHERE id = v_caller_id;

  -- Update Opponent if human (Zero-Sum system)
  IF v_opponent_id != '00000000-0000-0000-0000-000000000000' THEN
    UPDATE public.players SET rating = GREATEST(0, v_opponent_elo - v_elo_delta) WHERE id = v_opponent_id;
  END IF;

  -- 9b. Stamp last_match_played_at for human players (drives the 6h Elo-nudge push notification cron)
  UPDATE public.players SET last_match_played_at = now() WHERE id = v_caller_id;
  IF v_opponent_id != '00000000-0000-0000-0000-000000000000' THEN
    UPDATE public.players SET last_match_played_at = now() WHERE id = v_opponent_id;
  END IF;

  -- 10. Mark the match as permanently resolved!
  UPDATE public.matches SET elo_processed = TRUE WHERE id = p_match_id;

  -- Return the payload for the React Native Victory Animation!
  RETURN jsonb_build_object(
    'elo_change', v_elo_delta,
    'new_elo', v_new_elo,
    'already_processed', false
  );
END;
$function$
;


