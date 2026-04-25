import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    isActiveWindow,
    isBeforeTodayLocal,
    isInDailyCoinWindow,
} from './helpers.ts';
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

// Feature flag for blocks C (daily-coin) and D (Elo nudge). Flip to true after smoke testing.
const ENABLE_NEW_BLOCKS = true;

const BOT_UUID = '00000000-0000-0000-0000-000000000000';
async function sendPushNotification(expoPushToken, title, body) {
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) return;
    const expoPayload = {
        to: expoPushToken,
        sound: 'default',
        title: title,
        body: body
    };
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(expoPayload)
    });
    const expoData = await expoRes.json();
    if (!expoRes.ok) {
        throw new Error(`Expo Push API Error: ${JSON.stringify(expoData)}`);
    }
    return expoData;
}
serve(async (req) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
    try {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        const results = {
            requirementA: {
                attempted: 0,
                succeeded: 0,
                failed: 0
            },
            requirementB: {
                attempted: 0,
                succeeded: 0,
                failed: 0
            },
            requirementC: {
                attempted: 0,
                succeeded: 0,
                failed: 0,
                skipped: 0
            },
            requirementD: {
                attempted: 0,
                succeeded: 0,
                failed: 0,
                skipped: 0
            }
        };
        // --- Requirement A (30-min waiting room) ---
        const { data: waitingMatches, error: waitingError } = await supabaseAdmin.from('matches').select('id, player_white').eq('status', 'waiting').eq('is_private', true).eq('waiting_pn_sent', false).lte('created_at', thirtyMinsAgo);
        if (waitingError) throw new Error(`Error fetching waiting matches: ${waitingError.message}`);
        if (waitingMatches && waitingMatches.length > 0) {
            results.requirementA.attempted = waitingMatches.length;
            const aPromises = waitingMatches.map(async (match) => {
                if (!match.player_white) return;
                const { data: player } = await supabaseAdmin.from('players').select('expo_push_token').eq('id', match.player_white).single();
                if (player?.expo_push_token) {
                    await sendPushNotification(player.expo_push_token, "Nudge your friend to join in", "The Pico Chess game room is waiting.");
                }
                // Update to mark as sent, preventing endless loops
                await supabaseAdmin.from('matches').update({
                    waiting_pn_sent: true
                }).eq('id', match.id);
            });
            const aOutcomes = await Promise.allSettled(aPromises);
            aOutcomes.forEach((outcome) => {
                if (outcome.status === 'fulfilled') results.requirementA.succeeded++;
                else {
                    console.error('Req A Failure:', outcome.reason);
                    results.requirementA.failed++;
                }
            });
        }
        // --- Requirement B (1-hour loss) ---
        const { data: completedMatches, error: completedError } = await supabaseAdmin.from('matches').select('id, player_white, player_black, game_state').eq('status', 'completed').eq('loss_pn_sent', false).lte('created_at', sixtyMinsAgo);
        if (completedError) throw new Error(`Error fetching completed matches: ${completedError.message}`);
        if (completedMatches && completedMatches.length > 0) {
            results.requirementB.attempted = completedMatches.length;
            const bPromises = completedMatches.map(async (match) => {
                const gameState = typeof match.game_state === 'string' ? JSON.parse(match.game_state) : match.game_state;
                // Handle draw or missing game state
                if (!gameState || gameState.winner === 'draw' || !gameState.winner) {
                    await supabaseAdmin.from('matches').update({
                        loss_pn_sent: true
                    }).eq('id', match.id);
                    return;
                }
                const loserId = gameState.winner === 'white' ? match.player_black : match.player_white;
                if (loserId) {
                    const { data: player } = await supabaseAdmin.from('players').select('expo_push_token').eq('id', loserId).single();
                    if (player?.expo_push_token) {
                        await sendPushNotification(player.expo_push_token, "Luck is on your side now", "Play Pico Chess and win this time.");
                    }
                }
                await supabaseAdmin.from('matches').update({
                    loss_pn_sent: true
                }).eq('id', match.id);
            });
            const bOutcomes = await Promise.allSettled(bPromises);
            bOutcomes.forEach((outcome) => {
                if (outcome.status === 'fulfilled') results.requirementB.succeeded++;
                else {
                    console.error('Req B Failure:', outcome.reason);
                    results.requirementB.failed++;
                }
            });
        }
        // --- Requirement C (daily-coin reminder, ~21:00 local) ---
        // --- Requirement D (Elo comeback nudge, 6h post-match) ---
        if (ENABLE_NEW_BLOCKS) {
            // Block C: candidates are players with a push token + known timezone whose daily bonus
            // is unclaimed today. Per-tz local-time gating happens in JS since Postgres can't.
            const { data: candidatesC, error: cErr } = await supabaseAdmin
                .from('players')
                .select('id, expo_push_token, timezone, last_login_bonus, last_daily_coin_pn_at')
                .not('expo_push_token', 'is', null)
                .not('timezone', 'is', null);
            if (cErr) throw new Error(`Error fetching block C candidates: ${cErr.message}`);
            if (candidatesC && candidatesC.length > 0) {
                const cPromises = candidatesC.map(async (p) => {
                    const tz = p.timezone;
                    // Throttles: in 20:30–21:30 local, daily bonus not yet claimed today, no daily-coin PN today.
                    if (!isInDailyCoinWindow(tz)) { results.requirementC.skipped++; return; }
                    if (!isBeforeTodayLocal(p.last_login_bonus, tz)) { results.requirementC.skipped++; return; }
                    if (!isBeforeTodayLocal(p.last_daily_coin_pn_at, tz)) { results.requirementC.skipped++; return; }
                    results.requirementC.attempted++;
                    try {
                        await sendPushNotification(
                            p.expo_push_token,
                            'Your daily coins are waiting 🪙',
                            'Claim your daily bonus before midnight.'
                        );
                        await supabaseAdmin.from('players').update({ last_daily_coin_pn_at: new Date().toISOString() }).eq('id', p.id);
                        results.requirementC.succeeded++;
                    } catch (e) {
                        console.error('Req C Failure:', e);
                        results.requirementC.failed++;
                    }
                });
                await Promise.allSettled(cPromises);
            }

            // Block D: matches completed 6–7h ago, dedup'd via elo_nudge_sent. Each player on the match
            // is evaluated independently; bot opponent is skipped. Mark the match processed once both
            // sides are handled (or skipped) to prevent reprocessing across cron runs.
            const { data: matchesD, error: dErr } = await supabaseAdmin
                .from('matches')
                .select('id, player_white, player_black')
                .eq('status', 'completed')
                .eq('elo_nudge_sent', false)
                .gte('created_at', sevenHoursAgo)
                .lte('created_at', sixHoursAgo);
            if (dErr) throw new Error(`Error fetching block D matches: ${dErr.message}`);
            if (matchesD && matchesD.length > 0) {
                const dPromises = matchesD.map(async (match) => {
                    const playerIds = [match.player_white, match.player_black].filter(
                        (id) => id && id !== BOT_UUID
                    );
                    for (const pid of playerIds) {
                        const { data: player } = await supabaseAdmin
                            .from('players')
                            .select('expo_push_token, timezone, rating, last_elo_nudge_pn_at')
                            .eq('id', pid)
                            .single();
                        if (!player?.expo_push_token || !player?.timezone) { results.requirementD.skipped++; continue; }
                        if (!isActiveWindow(player.timezone)) { results.requirementD.skipped++; continue; }
                        if (!isBeforeTodayLocal(player.last_elo_nudge_pn_at, player.timezone)) { results.requirementD.skipped++; continue; }
                        results.requirementD.attempted++;
                        try {
                            await sendPushNotification(
                                player.expo_push_token,
                                'Pico Chess is calling you back!',
                                `You're at ${player.rating ?? 1000} Elo — one good game could push you higher.`
                            );
                            await supabaseAdmin.from('players').update({ last_elo_nudge_pn_at: new Date().toISOString() }).eq('id', pid);
                            results.requirementD.succeeded++;
                        } catch (e) {
                            console.error('Req D Failure:', e);
                            results.requirementD.failed++;
                        }
                    }
                    // Always mark the match processed so it never gets re-evaluated.
                    await supabaseAdmin.from('matches').update({ elo_nudge_sent: true }).eq('id', match.id);
                });
                await Promise.allSettled(dPromises);
            }
        }

        console.log('cron-reminders results:', JSON.stringify(results));
        return new Response(JSON.stringify({
            success: true,
            results
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        console.error('Cron Function Error:', err.message);
        return new Response(JSON.stringify({
            error: err.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
});
