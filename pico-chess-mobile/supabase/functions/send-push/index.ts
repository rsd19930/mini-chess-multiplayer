import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req: Request) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const bodyText = await req.text()
        const { expo_push_token, title, body } = JSON.parse(bodyText)

        // Validate token presence and 'ExponentPushToken' prefix
        if (!expo_push_token || typeof expo_push_token !== 'string') {
            return new Response(JSON.stringify({ error: 'Missing or invalid expo_push_token' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        if (!expo_push_token.startsWith('ExponentPushToken[')) {
            return new Response(JSON.stringify({ error: 'Invalid Expo Push Token format' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        if (!title || !body) {
            return new Response(JSON.stringify({ error: 'Missing title or body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            })
        }

        // Construct the Expo Push Notification payload
        const expoPayload = {
            to: expo_push_token,
            sound: 'default',
            title: title,
            body: body,
        }

        // Send the request to Expo's Push API
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
            console.error('Expo Push API Error:', expoData)
            throw new Error(`Expo Push API Error: ${JSON.stringify(expoData)}`)
        }

        return new Response(JSON.stringify({ success: true, expoResponse: expoData }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })

    } catch (err: any) {
        console.error('Function Error:', err.message)
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
    }
})
