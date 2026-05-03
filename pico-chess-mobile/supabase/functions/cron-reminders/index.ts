import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    isBeforeTodayLocal,
    isInDailyCoinWindow,
    isInInactiveReminderWindow,
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

const PLAY_STORE_URL = 'https://play.picochess.online';

// Send a daily-coin reminder email via Resend. Returns a structured result so the
// caller can distinguish between quota-exhausted (short-circuit), transient failure
// (skip + try next tick), and success (stamp last_email_at).
async function sendDailyCoinEmailViaResend(toEmail: string) {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Pico Chess <onboarding@resend.dev>';
    if (!apiKey) {
        return { ok: false, status: 0, quotaExhausted: false, errorBody: 'RESEND_API_KEY not set' };
    }

    const subject = 'Pico Chess - Your daily coins are waiting 🪙';
    const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f7faf7; color: #2A343A;">
  <h2 style="color: #2A343A; margin-top: 0;">Pico Chess ♟️</h2>
  <p style="font-size: 15px; line-height: 1.5;">Your daily coin bonus is sitting in the app waiting to be claimed. Pop in for a quick 6×6 match — under 5 minutes, big tactical kick.</p>
  <p style="margin: 28px 0;">
    <a href="${PLAY_STORE_URL}" style="background: #4ade80; color: #0d2818; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Claim your daily coins</a>
  </p>
  <p style="font-size: 12px; color: #6b7280; margin-top: 32px; line-height: 1.4;">You're receiving this because you signed up to Pico Chess. Reply STOP to this email to unsubscribe.</p>
</body></html>`;
    const text = `Your daily coin bonus is waiting in Pico Chess.

Open the app: ${PLAY_STORE_URL}

You're receiving this because you signed up to Pico Chess. Reply STOP to this email to unsubscribe.`;

    let resp: Response;
    try {
        resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [toEmail],
                subject,
                html,
                text,
                // RFC 8058 / RFC 2369 headers — Gmail uses these to surface a one-click
                // "Unsubscribe" link in the inbox UI. Even without a real unsub handler,
                // their presence is a strong "good sender" signal for spam filters and
                // costs us nothing (the mailto bounces, which Gmail treats as effective
                // unsub anyway).
                headers: {
                    'List-Unsubscribe': '<mailto:doreply@info.picochess.online?subject=unsubscribe>',
                    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                }
            })
        });
    } catch (e) {
        return { ok: false, status: 0, quotaExhausted: false, errorBody: `Network: ${e}` };
    }

    if (resp.ok) return { ok: true, status: resp.status, quotaExhausted: false, errorBody: null };

    const errorBody = await resp.text().catch(() => '<unreadable>');
    // Treat 429 (rate-limit) and 402 (payment-required / quota) as quota-exhausted →
    // short-circuit the rest of the block to save invocation time.
    const quotaExhausted = resp.status === 429 || resp.status === 402;
    return { ok: false, status: resp.status, quotaExhausted, errorBody };
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
            },
            requirementE: {
                attempted: 0,
                succeeded: 0,
                failed: 0,
                skipped: 0,
                quotaExhausted: false
            },
            requirementF: {
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
            // Block C: candidates are players with a push token whose daily bonus is unclaimed today.
            // Users without a stamped timezone fall back to UTC so they're not silently filtered out.
            const { data: candidatesC, error: cErr } = await supabaseAdmin
                .from('players')
                .select('id, expo_push_token, timezone, last_login_bonus, last_daily_coin_pn_at')
                .not('expo_push_token', 'is', null);
            if (cErr) throw new Error(`Error fetching block C candidates: ${cErr.message}`);
            if (candidatesC && candidatesC.length > 0) {
                const cPromises = candidatesC.map(async (p) => {
                    const tz = p.timezone || 'UTC';
                    // Throttles: in 20:30–21:30 local-or-UTC, daily bonus not yet claimed today, no daily-coin PN today.
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
                        if (!player?.expo_push_token) { results.requirementD.skipped++; continue; }
                        const tz = player.timezone || 'UTC';
                        if (!isBeforeTodayLocal(player.last_elo_nudge_pn_at, tz)) { results.requirementD.skipped++; continue; }
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

            // --- Block E (daily-coin reminder EMAIL — fallback for users without PN permission) ---
            // Hard rules: PN-token-less users only; "drifted" cohort (no activity in last 7 days);
            // max 1 email/user/3 days; silent fallback on Resend quota exhaustion.
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();
            const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).getTime();
            const within = (ts: string | null | undefined, cutoffMs: number): boolean =>
                ts != null && new Date(ts).getTime() > cutoffMs;

            const { data: candidatesE, error: eErr } = await supabaseAdmin
                .from('players')
                .select('id, timezone, last_login_bonus, last_match_played_at, last_daily_coin_pn_at, last_elo_nudge_pn_at, last_email_at')
                .is('expo_push_token', null)
                .neq('id', BOT_UUID);
            if (eErr) throw new Error(`Error fetching block E candidates: ${eErr.message}`);

            for (const p of candidatesE ?? []) {
                if (results.requirementE.quotaExhausted) {
                    results.requirementE.skipped++;
                    continue;
                }
                const tz = p.timezone || 'UTC';

                // Inactivity gate: NONE of the activity signals within last 7 days.
                if ([p.last_match_played_at, p.last_login_bonus, p.last_daily_coin_pn_at, p.last_elo_nudge_pn_at]
                    .some((ts) => within(ts, sevenDaysAgo))) {
                    results.requirementE.skipped++;
                    continue;
                }

                // 1-email-per-user-per-3-days dedup.
                if (within(p.last_email_at, threeDaysAgo)) {
                    results.requirementE.skipped++;
                    continue;
                }

                // Same daily-coin trigger semantics as Block C.
                if (!isInDailyCoinWindow(tz)) { results.requirementE.skipped++; continue; }
                if (!isBeforeTodayLocal(p.last_login_bonus, tz)) { results.requirementE.skipped++; continue; }

                // Look up email from auth.users via service role.
                const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(p.id);
                if (authErr || !authData?.user?.email) {
                    results.requirementE.skipped++;
                    continue;
                }

                results.requirementE.attempted++;
                const send = await sendDailyCoinEmailViaResend(authData.user.email);
                if (send.quotaExhausted) {
                    results.requirementE.quotaExhausted = true;
                    console.warn('Resend quota exhausted; skipping rest of Block E. Last error:', send.errorBody);
                    // Do NOT stamp last_email_at — we want this user to be retried tomorrow.
                    continue;
                }
                if (!send.ok) {
                    console.error('Req E failure:', send.status, send.errorBody);
                    results.requirementE.failed++;
                    // Do NOT stamp on transient failure either.
                    continue;
                }
                await supabaseAdmin.from('players').update({ last_email_at: new Date().toISOString() }).eq('id', p.id);
                results.requirementE.succeeded++;
            }

            // --- Block F (inactive-user PN — "your coins are gathering dust", at ~13:00 local) ---
            // Audience: users with a push token whose last match was >3 days ago, OR who
            // never played a match. Throttle: max once per 3 days per user.
            const threeDaysAgoIsoF = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const threeDaysAgoMsF = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).getTime();
            const { data: candidatesF, error: fErr } = await supabaseAdmin
                .from('players')
                .select('id, expo_push_token, timezone, coins, last_match_played_at, last_inactive_pn_at')
                .not('expo_push_token', 'is', null)
                .neq('id', BOT_UUID)
                .or(`last_match_played_at.lt.${threeDaysAgoIsoF},last_match_played_at.is.null`);
            if (fErr) throw new Error(`Error fetching block F candidates: ${fErr.message}`);
            if (candidatesF && candidatesF.length > 0) {
                const fPromises = candidatesF.map(async (p) => {
                    const tz = p.timezone || 'UTC';
                    if (!isInInactiveReminderWindow(tz)) { results.requirementF.skipped++; return; }
                    // 1-PN-per-user-per-3-days dedup.
                    if (p.last_inactive_pn_at && new Date(p.last_inactive_pn_at).getTime() > threeDaysAgoMsF) {
                        results.requirementF.skipped++;
                        return;
                    }
                    results.requirementF.attempted++;
                    try {
                        const coins = (p.coins ?? 0).toLocaleString('en-US');
                        await sendPushNotification(
                            p.expo_push_token,
                            'Your coins are gathering dust 🪙',
                            `You have ${coins} coins sitting unused — pop in for a quick 6×6 match.`
                        );
                        await supabaseAdmin.from('players').update({ last_inactive_pn_at: new Date().toISOString() }).eq('id', p.id);
                        results.requirementF.succeeded++;
                    } catch (e) {
                        console.error('Req F Failure:', e);
                        results.requirementF.failed++;
                    }
                });
                await Promise.allSettled(fPromises);
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
