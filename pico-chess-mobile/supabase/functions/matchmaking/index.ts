import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const PICOBOT_UUID = '00000000-0000-0000-0000-000000000000'

serve(async (req) => {
  // CORS Headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { userId } = await req.json()
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400 })
    }

    // 1. Check for an existing waiting match that isn't me
    const { data: waitingMatch, error: selectError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('status', 'waiting')
      .not('player_white', 'eq', userId)
      .limit(1)
      .maybeSingle()

    if (waitingMatch) {
      // 2. We found a match! Join it as player_black.
      const { data: updatedMatch, error: updateError } = await supabaseAdmin
        .from('matches')
        .update({ player_black: userId, status: 'active', started_at: new Date().toISOString() })
        .eq('id', waitingMatch.id)
        .select()
        .single()

      return new Response(JSON.stringify(updatedMatch), { headers: { 'Content-Type': 'application/json' } })
    }

    // 3. No match found? Create a new waiting match with myself as white.
    const { data: newMatch, error: insertError } = await supabaseAdmin
      .from('matches')
      .insert([{ player_white: userId, status: 'waiting' }])
      .select()
      .single()

    if (insertError || !newMatch) throw new Error('Failed to create match')

    // 4. Return early so the client can subscribe to Realtime via Expo
    // BUT we don't finish the edge function. We use Web Workers or just sleep in an async context?
    // Edge functions run per request. To trigger the bot, we can use an async invocation!
    // Since we need to let the client connect Realtime, we could just let the client trigger a second "timeout" function, 
    // OR we sleep here but that blocks the client's HTTP response.

    // Better Architecture for Edge Function: Client creates the match row directly (RLS permitted).
    // An Edge function is triggered by a database Webhook on INSERT into matches.
    // BUT wait, we need to respond to the HTTP request. We can just sleep and check, returning the initial match, 
    // and let the client listen to realtime. No, we must send a response. Wait, we can use `Edge Functions background tasks`.
    // Deno Deploy supports `Edge Runtime` which terminates when the response is sent. 
    // So if the client creates the queue row, how does the bot join? The simplest way is IF the client calls `matchmaking`, 
    // we return the created match instantly. The client waits. After 30s, if the match isn't active, the client calls `assign_bot` endpoint!
    // That prevents sleeping in Edge Functions. Let's do that! So this endpoint purely handles Queue Join.

    return new Response(JSON.stringify(newMatch), { headers: { 'Content-Type': 'application/json' } })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
