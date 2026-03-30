import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

async function sendPushNotification(expoPushToken: string, title: string, body: string) {
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) return;

    const expoPayload = {
        to: expoPushToken,
        sound: 'default',
        title: title,
        body: body,
    }

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(expoPayload),
    })

    const expoData = await expoRes.json()
    if (!expoRes.ok) {
        throw new Error(`Expo Push API Error: ${JSON.stringify(expoData)}`)
    }
    return expoData;
}

serve(async (req: Request) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
    }

    try {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

        const results = {
            requirementA: { attempted: 0, succeeded: 0, failed: 0 },
            requirementB: { attempted: 0, succeeded: 0, failed: 0 }
        };

        // --- Requirement A (30-min waiting room) ---
        const { data: waitingMatches, error: waitingError } = await supabaseAdmin
            .from('matches')
            .select('id, player_white')
            .eq('status', 'waiting')
            .eq('is_private', true)
            .eq('waiting_pn_sent', false)
            .lte('created_at', thirtyMinsAgo);

        if (waitingError) throw new Error(`Error fetching waiting matches: ${waitingError.message}`);

        if (waitingMatches && waitingMatches.length > 0) {
            results.requirementA.attempted = waitingMatches.length;
            const aPromises = waitingMatches.map(async (match: any) => {
                if (!match.player_white) return;

                const { data: player } = await supabaseAdmin
                    .from('players')
                    .select('expo_push_token')
                    .eq('id', match.player_white)
                    .single();

                if (player?.expo_push_token) {
                    await sendPushNotification(
                        player.expo_push_token,
                        "Nudge your friend to join in",
                        "The Pico Chess game room is waiting."
                    );
                }

                // Update to mark as sent, preventing endless loops
                await supabaseAdmin
                    .from('matches')
                    .update({ waiting_pn_sent: true })
                    .eq('id', match.id);
            });

            const aOutcomes = await Promise.allSettled(aPromises);
            aOutcomes.forEach((outcome: any) => {
                if (outcome.status === 'fulfilled') results.requirementA.succeeded++;
                else {
                    console.error('Req A Failure:', outcome.reason);
                    results.requirementA.failed++;
                }
            });
        }

        // --- Requirement B (1-hour loss) ---
        const { data: completedMatches, error: completedError } = await supabaseAdmin
            .from('matches')
            .select('id, player_white, player_black, game_state')
            .eq('status', 'completed')
            .eq('loss_pn_sent', false)
            .lte('created_at', sixtyMinsAgo);

        if (completedError) throw new Error(`Error fetching completed matches: ${completedError.message}`);

        if (completedMatches && completedMatches.length > 0) {
            results.requirementB.attempted = completedMatches.length;
            const bPromises = completedMatches.map(async (match: any) => {
                const gameState = typeof match.game_state === 'string' ? JSON.parse(match.game_state) : match.game_state;

                // Handle draw or missing game state
                if (!gameState || gameState.winner === 'draw' || !gameState.winner) {
                    await supabaseAdmin.from('matches').update({ loss_pn_sent: true }).eq('id', match.id);
                    return;
                }

                const loserId = gameState.winner === 'white' ? match.player_black : match.player_white;

                if (loserId) {
                    const { data: player } = await supabaseAdmin
                        .from('players')
                        .select('expo_push_token')
                        .eq('id', loserId)
                        .single();

                    if (player?.expo_push_token) {
                        await sendPushNotification(
                            player.expo_push_token,
                            "Luck is on your side now",
                            "Play Pico Chess and win this time."
                        );
                    }
                }

                await supabaseAdmin
                    .from('matches')
                    .update({ loss_pn_sent: true })
                    .eq('id', match.id);
            });

            const bOutcomes = await Promise.allSettled(bPromises);
            bOutcomes.forEach((outcome: any) => {
                if (outcome.status === 'fulfilled') results.requirementB.succeeded++;
                else {
                    console.error('Req B Failure:', outcome.reason);
                    results.requirementB.failed++;
                }
            });
        }

        return new Response(JSON.stringify({ success: true, results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });

    } catch (err: any) {
        console.error('Cron Function Error:', err.message);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
});
