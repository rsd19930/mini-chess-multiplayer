import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)
const PICOBOT_UUID = '00000000-0000-0000-0000-000000000000'

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
    }

    try {
        const { matchId } = await req.json()

        // Assign Picobot to the match
        const { data: updatedMatch, error: updateError } = await supabaseAdmin
            .from('matches')
            .update({ player_black: PICOBOT_UUID, status: 'active', started_at: new Date().toISOString() })
            .eq('id', matchId)
            .eq('status', 'waiting') // Only if still waiting
            .select()
            .single()

        if (updateError) throw new Error(updateError.message)
        return new Response(JSON.stringify(updatedMatch), { headers: { 'Content-Type': 'application/json' } })

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 })
    }
})
