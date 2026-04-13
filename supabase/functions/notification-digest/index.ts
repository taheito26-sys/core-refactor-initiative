const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token)
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const userId = claims.claims.sub

    // Fetch unread notifications
    const { data: notifications, error: fetchError } = await supabase
      .from('notifications')
      .select('title, body, category, created_at')
      .eq('user_id', userId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(30)

    if (fetchError) throw fetchError

    if (!notifications || notifications.length === 0) {
      return new Response(JSON.stringify({
        summary: 'No unread notifications. You\'re all caught up! 🎉',
        count: 0,
        categories: {},
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Count by category
    const categories: Record<string, number> = {}
    for (const n of notifications) {
      categories[n.category] = (categories[n.category] || 0) + 1
    }

    // Build prompt
    const notifText = notifications.map((n, i) =>
      `${i + 1}. [${n.category}] ${n.title}${n.body ? ': ' + n.body : ''} (${n.created_at})`
    ).join('\n')

    const prompt = `You are a concise business assistant for a P2P trading platform. Summarize the following ${notifications.length} unread notifications into a brief executive digest (3-5 bullet points max). Focus on actionable items first (approvals, invites needing response), then informational updates. Use business-friendly language. Keep it under 150 words.

Notifications:
${notifText}

Reply with ONLY the digest summary, no preamble.`

    // Call Lovable AI Gateway
    const aiResponse = await fetch('https://ai-gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      console.error('AI Gateway error:', errText)
      // Fallback: return a simple count-based summary
      const fallback = Object.entries(categories)
        .map(([cat, count]) => `• ${count} ${cat} notification${count > 1 ? 's' : ''}`)
        .join('\n')
      return new Response(JSON.stringify({
        summary: `You have ${notifications.length} unread notifications:\n${fallback}`,
        count: notifications.length,
        categories,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const aiData = await aiResponse.json()
    const summary = aiData.choices?.[0]?.message?.content ?? 'Unable to generate summary.'

    return new Response(JSON.stringify({
      summary,
      count: notifications.length,
      categories,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('Digest error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
