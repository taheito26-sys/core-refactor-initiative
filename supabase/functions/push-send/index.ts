/**
 * push-send — Delivers push notifications via FCM v1 HTTP API.
 *
 * Called by the DB trigger (via pg_net) or directly after a notification insert.
 * Expects: { user_id, title, body, data? }
 *
 * Requires FCM_SERVICE_ACCOUNT_JSON secret.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

interface PushPayload {
  user_id: string;
  title: string;
  body?: string;
  data?: Record<string, string>;
}

interface FCMServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// Build a JWT for FCM OAuth2
async function buildFCMAccessToken(sa: FCMServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const textEncoder = new TextEncoder();
  const input = textEncoder.encode(`${header}.${payload}`);

  // Import the private key
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, input);
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const jwt = `${header}.${payload}.${sig64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token');
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fcmJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
    if (!fcmJson) {
      // FCM not configured — silently succeed (push is optional)
      return new Response(JSON.stringify({ sent: 0, reason: 'fcm_not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sa: FCMServiceAccount = JSON.parse(fcmJson);
    const payload: PushPayload = await req.json();

    if (!payload.user_id || !payload.title) {
      return new Response(JSON.stringify({ error: 'user_id and title required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's device tokens
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tokens } = await supabase
      .from('push_device_tokens')
      .select('token, platform')
      .eq('user_id', payload.user_id);

    if (!tokens?.length) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await buildFCMAccessToken(sa);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    const staleTokens: string[] = [];

    for (const { token, platform } of tokens) {
      const message: Record<string, unknown> = {
        token,
        notification: { title: payload.title, body: payload.body ?? '' },
        data: payload.data ?? {},
      };

      // Platform-specific config
      if (platform === 'android') {
        message.android = { priority: 'high', notification: { channel_id: 'default' } };
      } else if (platform === 'ios') {
        message.apns = { payload: { aps: { sound: 'default', badge: 1 } } };
      }

      const res = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (res.ok) {
        sent++;
      } else {
        const err = await res.json();
        const code = err?.error?.details?.[0]?.errorCode ?? err?.error?.code;
        if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
          staleTokens.push(token);
        }
        console.error('[push-send] FCM error for token:', token.slice(0, 10), err);
      }
    }

    // Cleanup stale tokens
    if (staleTokens.length) {
      await supabase
        .from('push_device_tokens')
        .delete()
        .in('token', staleTokens);
    }

    return new Response(JSON.stringify({ sent, stale_removed: staleTokens.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[push-send] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
