create extension if not exists "pg_cron" with schema "pg_catalog";

drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

create type "public"."transaction_type" as enum ('new_user_bonus', 'daily_login', 'match_fee', 'match_reward', 'match_refund', 'referral_bonus', 'iap', 'bot_fee');


  create table "public"."bot_difficulty_elos" (
    "depth" integer not null,
    "elo" integer not null
      );


alter table "public"."bot_difficulty_elos" enable row level security;


  create table "public"."coin_ledger" (
    "id" uuid not null default gen_random_uuid(),
    "player_id" uuid not null,
    "amount" integer not null,
    "type" public.transaction_type not null,
    "match_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "external_transaction_id" text
      );


alter table "public"."coin_ledger" enable row level security;


  create table "public"."economy_config" (
    "id" integer not null default 1,
    "new_user_bonus" integer default 1000,
    "daily_login_bonus" integer default 500,
    "match_fee" integer default 100,
    "match_reward" integer default 200,
    "referral_bonus" integer not null default 1000,
    "bot_cost_easy" integer default 150,
    "bot_cost_medium" integer default 100,
    "bot_cost_hard" integer default 50
      );


alter table "public"."economy_config" enable row level security;


  create table "public"."feedbacks" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "feedback_text" text not null,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."feedbacks" enable row level security;

alter table "public"."matches" add column "elo_processed" boolean default false;

alter table "public"."matches" add column "game_state" jsonb default '{}'::jsonb;

alter table "public"."matches" add column "is_private" boolean not null default false;

alter table "public"."matches" add column "loss_pn_sent" boolean default false;

alter table "public"."matches" add column "waiting_pn_sent" boolean default false;

alter table "public"."matches" enable row level security;

alter table "public"."players" add column "coins" integer default 0;

alter table "public"."players" add column "created_at" timestamp with time zone not null default timezone('utc'::text, now());

alter table "public"."players" add column "expo_push_token" text;

alter table "public"."players" add column "last_login_bonus" timestamp with time zone;

alter table "public"."players" add column "referred_by" uuid;

alter table "public"."players" enable row level security;

CREATE UNIQUE INDEX bot_difficulty_elos_pkey ON public.bot_difficulty_elos USING btree (depth);

CREATE UNIQUE INDEX coin_ledger_pkey ON public.coin_ledger USING btree (id);

CREATE UNIQUE INDEX economy_config_pkey ON public.economy_config USING btree (id);

CREATE UNIQUE INDEX feedbacks_pkey ON public.feedbacks USING btree (id);

alter table "public"."bot_difficulty_elos" add constraint "bot_difficulty_elos_pkey" PRIMARY KEY using index "bot_difficulty_elos_pkey";

alter table "public"."coin_ledger" add constraint "coin_ledger_pkey" PRIMARY KEY using index "coin_ledger_pkey";

alter table "public"."economy_config" add constraint "economy_config_pkey" PRIMARY KEY using index "economy_config_pkey";

alter table "public"."feedbacks" add constraint "feedbacks_pkey" PRIMARY KEY using index "feedbacks_pkey";

alter table "public"."coin_ledger" add constraint "coin_ledger_match_id_fkey" FOREIGN KEY (match_id) REFERENCES public.matches(id) not valid;

alter table "public"."coin_ledger" validate constraint "coin_ledger_match_id_fkey";

alter table "public"."coin_ledger" add constraint "coin_ledger_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) not valid;

alter table "public"."coin_ledger" validate constraint "coin_ledger_player_id_fkey";

alter table "public"."feedbacks" add constraint "feedbacks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.players(id) ON DELETE CASCADE not valid;

alter table "public"."feedbacks" validate constraint "feedbacks_user_id_fkey";

alter table "public"."players" add constraint "players_referred_by_fkey" FOREIGN KEY (referred_by) REFERENCES public.players(id) not valid;

alter table "public"."players" validate constraint "players_referred_by_fkey";

set check_function_bodies = off;

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

CREATE OR REPLACE FUNCTION public.claim_victory_reward(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_player_id UUID;
  v_reward INT;
  v_balance INT;
  v_already_claimed BOOLEAN;
BEGIN
  v_player_id := auth.uid();
  
  -- Prevent double-claiming (checking the ledger to see if they already got paid for this match)
  SELECT EXISTS(
    SELECT 1 FROM public.coin_ledger 
    WHERE match_id = p_match_id AND type = 'match_reward' AND player_id = v_player_id
  ) INTO v_already_claimed;
  
  IF v_already_claimed THEN
    RETURN json_build_object('success', false, 'message', 'Reward already claimed');
  END IF;
  
  -- Get the reward amount from config
  SELECT match_reward INTO v_reward FROM public.economy_config WHERE id = 1;
  
  -- Add the reward
  UPDATE public.players SET coins = COALESCE(coins, 0) + v_reward WHERE id = v_player_id RETURNING coins INTO v_balance;
  
  -- Write the receipt
  INSERT INTO public.coin_ledger (player_id, amount, type, match_id)
  VALUES (v_player_id, v_reward, 'match_reward', p_match_id);
  
  RETURN json_build_object('success', true, 'coins', v_balance, 'reward', v_reward);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_bot_fee(p_match_id uuid, p_difficulty integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_player_id UUID;
  v_cost INT;
  v_balance INT;
BEGIN
  -- Securely get the user ID from the active session
  v_player_id := auth.uid();
  
  -- 1. Get the exact cost based on the chosen numeric depth (1=Easy, 2=Medium, 3=Hard)
  IF p_difficulty = 1 THEN
      SELECT bot_cost_easy INTO v_cost FROM public.economy_config WHERE id = 1;
  ELSIF p_difficulty = 2 THEN
      SELECT bot_cost_medium INTO v_cost FROM public.economy_config WHERE id = 1;
  ELSIF p_difficulty = 3 THEN
      SELECT bot_cost_hard INTO v_cost FROM public.economy_config WHERE id = 1;
  ELSE
      RETURN json_build_object('success', false, 'message', 'Invalid bot level');
  END IF;

  -- 2. Lock the player's row and check their balance
  SELECT COALESCE(coins, 0) INTO v_balance FROM public.players WHERE id = v_player_id FOR UPDATE;
  
  IF v_balance < v_cost THEN
    RETURN json_build_object('success', false, 'message', 'Not enough coins!');
  END IF;

  -- 3. Deduct the fee
  UPDATE public.players SET coins = coins - v_cost WHERE id = v_player_id RETURNING coins INTO v_balance;
  
  -- 4. Write the receipt to the coin ledger
  INSERT INTO public.coin_ledger (player_id, amount, type, match_id)
  VALUES (v_player_id, -v_cost, 'bot_fee', p_match_id);
  
  RETURN json_build_object('success', true, 'coins', v_balance);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_entry_fee(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_player_id UUID;
  v_fee INT;
  v_balance INT;
BEGIN
  v_player_id := auth.uid();
  
  -- Get the fee amount from config
  SELECT match_fee INTO v_fee FROM public.economy_config WHERE id = 1;
  
  -- Lock the player's row and check their balance
  SELECT COALESCE(coins, 0) INTO v_balance FROM public.players WHERE id = v_player_id FOR UPDATE;
  
  IF v_balance < v_fee THEN
    RETURN json_build_object('success', false, 'message', 'Not enough coins!');
  END IF;
  
  -- Deduct the fee
  UPDATE public.players SET coins = coins - v_fee WHERE id = v_player_id RETURNING coins INTO v_balance;
  
  -- Write the receipt
  INSERT INTO public.coin_ledger (player_id, amount, type, match_id)
  VALUES (v_player_id, -v_fee, 'match_fee', p_match_id);
  
  RETURN json_build_object('success', true, 'coins', v_balance);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_iap_purchase(p_player_id uuid, p_amount integer, p_transaction_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- 1. Security Check: Prevent duplicate processing of the same receipt
    IF EXISTS (SELECT 1 FROM public.coin_ledger WHERE external_transaction_id = p_transaction_id) THEN
        RETURN;
    END IF;

    -- 2. Add the coins to the player's profile
    UPDATE public.players
    SET coins = coins + p_amount
    WHERE id = p_player_id;

    -- 3. Log the transaction securely using the strict ENUM and new receipt column
    INSERT INTO public.coin_ledger (player_id, amount, type, external_transaction_id)
    VALUES (p_player_id, p_amount, 'iap', p_transaction_id);
END;
$function$
;

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

CREATE OR REPLACE FUNCTION public.reward_referrer(p_referrer_id uuid, p_referred_id uuid, p_bonus_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Add the coins to the referrer's profile
    UPDATE public.players
    SET coins = coins + p_bonus_amount
    WHERE id = p_referrer_id;

    -- Log the transaction securely using the correct column name 'type'
    INSERT INTO public.coin_ledger (player_id, amount, type)
    VALUES (p_referrer_id, p_bonus_amount, 'referral_bonus');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$DECLARE
  bonus_amount INT;
BEGIN
  -- Get the configured bonus amount
  SELECT new_user_bonus INTO bonus_amount FROM public.economy_config WHERE id = 1;

  -- Insert the new player with their initial coins
  INSERT INTO public.players (id, username, rating, coins)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Player_' || substr(NEW.id::text, 1, 6)),
    1200,
    bonus_amount
  );

  -- Log the transaction in the ledger
  INSERT INTO public.coin_ledger (player_id, amount, type)
  VALUES (NEW.id, bonus_amount, 'new_user_bonus');

  RETURN NEW;
END;$function$
;

grant delete on table "public"."bot_difficulty_elos" to "anon";

grant insert on table "public"."bot_difficulty_elos" to "anon";

grant references on table "public"."bot_difficulty_elos" to "anon";

grant select on table "public"."bot_difficulty_elos" to "anon";

grant trigger on table "public"."bot_difficulty_elos" to "anon";

grant truncate on table "public"."bot_difficulty_elos" to "anon";

grant update on table "public"."bot_difficulty_elos" to "anon";

grant delete on table "public"."bot_difficulty_elos" to "authenticated";

grant insert on table "public"."bot_difficulty_elos" to "authenticated";

grant references on table "public"."bot_difficulty_elos" to "authenticated";

grant select on table "public"."bot_difficulty_elos" to "authenticated";

grant trigger on table "public"."bot_difficulty_elos" to "authenticated";

grant truncate on table "public"."bot_difficulty_elos" to "authenticated";

grant update on table "public"."bot_difficulty_elos" to "authenticated";

grant delete on table "public"."bot_difficulty_elos" to "service_role";

grant insert on table "public"."bot_difficulty_elos" to "service_role";

grant references on table "public"."bot_difficulty_elos" to "service_role";

grant select on table "public"."bot_difficulty_elos" to "service_role";

grant trigger on table "public"."bot_difficulty_elos" to "service_role";

grant truncate on table "public"."bot_difficulty_elos" to "service_role";

grant update on table "public"."bot_difficulty_elos" to "service_role";

grant delete on table "public"."coin_ledger" to "anon";

grant insert on table "public"."coin_ledger" to "anon";

grant references on table "public"."coin_ledger" to "anon";

grant select on table "public"."coin_ledger" to "anon";

grant trigger on table "public"."coin_ledger" to "anon";

grant truncate on table "public"."coin_ledger" to "anon";

grant update on table "public"."coin_ledger" to "anon";

grant delete on table "public"."coin_ledger" to "authenticated";

grant insert on table "public"."coin_ledger" to "authenticated";

grant references on table "public"."coin_ledger" to "authenticated";

grant select on table "public"."coin_ledger" to "authenticated";

grant trigger on table "public"."coin_ledger" to "authenticated";

grant truncate on table "public"."coin_ledger" to "authenticated";

grant update on table "public"."coin_ledger" to "authenticated";

grant delete on table "public"."coin_ledger" to "service_role";

grant insert on table "public"."coin_ledger" to "service_role";

grant references on table "public"."coin_ledger" to "service_role";

grant select on table "public"."coin_ledger" to "service_role";

grant trigger on table "public"."coin_ledger" to "service_role";

grant truncate on table "public"."coin_ledger" to "service_role";

grant update on table "public"."coin_ledger" to "service_role";

grant delete on table "public"."economy_config" to "anon";

grant insert on table "public"."economy_config" to "anon";

grant references on table "public"."economy_config" to "anon";

grant select on table "public"."economy_config" to "anon";

grant trigger on table "public"."economy_config" to "anon";

grant truncate on table "public"."economy_config" to "anon";

grant update on table "public"."economy_config" to "anon";

grant delete on table "public"."economy_config" to "authenticated";

grant insert on table "public"."economy_config" to "authenticated";

grant references on table "public"."economy_config" to "authenticated";

grant select on table "public"."economy_config" to "authenticated";

grant trigger on table "public"."economy_config" to "authenticated";

grant truncate on table "public"."economy_config" to "authenticated";

grant update on table "public"."economy_config" to "authenticated";

grant delete on table "public"."economy_config" to "service_role";

grant insert on table "public"."economy_config" to "service_role";

grant references on table "public"."economy_config" to "service_role";

grant select on table "public"."economy_config" to "service_role";

grant trigger on table "public"."economy_config" to "service_role";

grant truncate on table "public"."economy_config" to "service_role";

grant update on table "public"."economy_config" to "service_role";

grant delete on table "public"."feedbacks" to "anon";

grant insert on table "public"."feedbacks" to "anon";

grant references on table "public"."feedbacks" to "anon";

grant select on table "public"."feedbacks" to "anon";

grant trigger on table "public"."feedbacks" to "anon";

grant truncate on table "public"."feedbacks" to "anon";

grant update on table "public"."feedbacks" to "anon";

grant delete on table "public"."feedbacks" to "authenticated";

grant insert on table "public"."feedbacks" to "authenticated";

grant references on table "public"."feedbacks" to "authenticated";

grant select on table "public"."feedbacks" to "authenticated";

grant trigger on table "public"."feedbacks" to "authenticated";

grant truncate on table "public"."feedbacks" to "authenticated";

grant update on table "public"."feedbacks" to "authenticated";

grant delete on table "public"."feedbacks" to "service_role";

grant insert on table "public"."feedbacks" to "service_role";

grant references on table "public"."feedbacks" to "service_role";

grant select on table "public"."feedbacks" to "service_role";

grant trigger on table "public"."feedbacks" to "service_role";

grant truncate on table "public"."feedbacks" to "service_role";

grant update on table "public"."feedbacks" to "service_role";


  create policy "Bot config is publicly readable"
  on "public"."bot_difficulty_elos"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Users can view own ledger entries"
  on "public"."coin_ledger"
  as permissive
  for select
  to authenticated
using ((player_id = auth.uid()));



  create policy "Economy config is publicly readable"
  on "public"."economy_config"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Users can insert own feedback"
  on "public"."feedbacks"
  as permissive
  for insert
  to authenticated
with check ((user_id = auth.uid()));



  create policy "Users can insert their own feedback"
  on "public"."feedbacks"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can view own feedback"
  on "public"."feedbacks"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));



  create policy "Authenticated users can create matches"
  on "public"."matches"
  as permissive
  for insert
  to authenticated
with check (((auth.uid() = player_white) OR (auth.uid() = player_black)));



  create policy "Players can update own or waiting matches"
  on "public"."matches"
  as permissive
  for update
  to authenticated
using (((auth.uid() = player_white) OR (auth.uid() = player_black) OR (status = 'waiting'::public.match_status)));



  create policy "Players can view own matches and waiting matches"
  on "public"."matches"
  as permissive
  for select
  to authenticated
using (((auth.uid() = player_white) OR (auth.uid() = player_black) OR (status = 'waiting'::public.match_status)));



  create policy "Players are viewable by authenticated users"
  on "public"."players"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Users can update own player record"
  on "public"."players"
  as permissive
  for update
  to authenticated
using ((auth.uid() = id))
with check ((auth.uid() = id));



