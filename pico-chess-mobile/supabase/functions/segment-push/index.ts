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
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const bodyText = await req.text()
        const { title, body, player_ids } = JSON.parse(bodyText)

        // Validate payload
        if (!title || !body || !player_ids || !Array.isArray(player_ids)) {
            return new Response(JSON.stringify({ error: 'Missing or invalid title, body, or player_ids array' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        if (player_ids.length === 0) {
            return new Response(JSON.stringify({ success: true, total_sent: 0, message: "Empty player_ids array" }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        // Fetch valid push tokens for the specified players
        const { data: players, error } = await supabaseAdmin
            .from('players')
            .select('expo_push_token')
            .in('id', player_ids)
            .not('expo_push_token', 'is', null);

        if (error) {
            throw new Error(`Error fetching players: ${error.message}`);
        }

        if (!players || players.length === 0) {
            return new Response(JSON.stringify({ success: true, total_sent: 0, message: "No valid tokens found for players" }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        // Filter and construct Expo payloads
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

        // Split into chunks of 100
        const chunks = [];
        for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
            chunks.push(messages.slice(i, i + CHUNK_SIZE));
        }

        // Send requests using Promise.all
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

            if (!expoRes.ok) {
                console.error('Expo Push API Error Chunk:', expoData);
                // Depending on requirements, we log the error but allow other chunks to proceed, 
                // or we could throw. The prompt implies we want to succeed gracefully.
                // If it fails completely, it won't add to totalSent.
            } else {
                // Determine how many succeeded in this chunk. Expo returns a data array
                // matching the size of the request chunk.
                if (expoData.data && Array.isArray(expoData.data)) {
                    totalSent += expoData.data.length;

                    // We can also parse and log specific delivery errors like DeviceNotRegistered
                    expoData.data.forEach((ticket: any) => {
                        if (ticket.status === 'error') {
                            console.error(`Error sending to token (handled by Expo later): ${ticket.message}`);
                        }
                    });
                }
            }
        });

        await Promise.all(pushPromises);

        return new Response(JSON.stringify({ success: true, total_sent: totalSent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })

    } catch (err: any) {
        console.error('Segment Push Function Error:', err.message)
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
    }
})
