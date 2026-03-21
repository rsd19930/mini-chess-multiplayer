import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const bodyText = await req.text()
        const { title, body, player_ids, admin_secret } = JSON.parse(bodyText)

        if (!title || !body || !player_ids || !Array.isArray(player_ids)) {
            return new Response(JSON.stringify({ error: 'Missing title, body, or player_ids' }), {
                status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        if (player_ids.length === 0) {
            return new Response(JSON.stringify({ success: true, total_sent: 0, message: "Empty array" }), {
                status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        // Start building the query
        let query = supabaseAdmin
            .from('players')
            .select('expo_push_token')
            .not('expo_push_token', 'is', null);

        // Check if this is a global broadcast
        if (player_ids.length === 1 && player_ids[0] === "ALL") {
            // SECURITY CHECK: Only allow "ALL" if the correct secret is provided
            if (admin_secret !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Invalid admin_secret for broadcast' }), {
                    status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
                })
            }
            // We don't filter by ID, so it fetches everyone!
        } else {
            // Normal segment mode: filter by the provided IDs
            query = query.in('id', player_ids);
        }

        const { data: players, error } = await query;

        if (error) throw new Error(`Error fetching players: ${error.message}`);

        if (!players || players.length === 0) {
            return new Response(JSON.stringify({ success: true, total_sent: 0, message: "No valid tokens found" }), {
                status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        // Construct Expo payloads
        const messages = players
            .filter((p: any) => p.expo_push_token && p.expo_push_token.startsWith('ExponentPushToken['))
            .map((p: any) => ({
                to: p.expo_push_token,
                sound: 'default',
                title: title,
                body: body,
            }));

        let totalSent = 0;
        const CHUNK_SIZE = 100;
        const chunks = [];

        for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
            chunks.push(messages.slice(i, i + CHUNK_SIZE));
        }

        const pushPromises = chunks.map(async (chunk) => {
            const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(chunk),
            });

            const expoData = await expoRes.json();

            if (expoRes.ok && expoData.data && Array.isArray(expoData.data)) {
                totalSent += expoData.data.length;
            } else {
                console.error('Expo Push API Error Chunk:', expoData);
            }
        });

        await Promise.all(pushPromises);

        return new Response(JSON.stringify({ success: true, total_sent: totalSent }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })

    } catch (err: any) {
        console.error('Segment Push Error:', err.message)
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
    }
})