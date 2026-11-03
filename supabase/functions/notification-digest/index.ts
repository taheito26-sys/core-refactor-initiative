const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

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
      const category = n.category || 'other'
      categories[category] = (categories[category] || 0) + 1
    }

    // Keep the digest within Supabase; no external AI gateway or API key is required.
    const lines = Object.entries(categories)
      .map(([category, count]) => `• ${count} ${category} notification${count > 1 ? 's' : ''}`)
      .join('\n')
    const summary = `You have ${notifications.length} unread notifications:\n${lines}`

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
