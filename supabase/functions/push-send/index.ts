/**
 * push-send — single delivery point for every push notification.
 *
 * Callers
 *   • the AFTER INSERT trigger on public.notifications (x-push-secret header)
 *   • the app, for a device test or an incoming call (user JWT)
 *   • the public_key action, which lets a browser subscribe (no auth needed)
 *
 * Transports
 *   • Web Push (VAPID) for browsers and installed PWAs — always available
 *   • FCM v1 for the Capacitor Android/iOS app — used when
 *     FCM_SERVICE_ACCOUNT_JSON is configured
 *
 * The function enforces the user's master switch, per-category preferences,
 * quiet hours and foreground presence before touching a transport.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface PushConfig {
  webhook_secret: string;
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  vapid_subject: string;
}

interface SendResult {
  web: number;
  native: number;
  skipped?: string;
  stale_removed: number;
  fcm_configured: boolean;
}

interface SendOptions {
  ignoreQuietHours?: boolean;
  ignorePresence?: boolean;
  ignoreCategory?: boolean;
  ignoreAllFilters?: boolean;
}

let configCache: PushConfig | null = null;
let vapidConfigured = false;
let fcmTokenCache: { token: string; expiresAt: number } | null = null;

// ── helpers ────────────────────────────────────────────────────────────────

function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqual(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getConfig(): Promise<PushConfig> {
  if (configCache) return configCache;

  let { data, error } = await admin
    .from('push_dispatch_config')
    .select('webhook_secret, vapid_public_key, vapid_private_key, vapid_subject')
    .eq('id', true)
    .maybeSingle();

  if (error) throw new Error(`push config unavailable: ${error.message}`);

  if (!data) {
    await admin.from('push_dispatch_config').insert({
      id: true,
      webhook_secret: randomHex(),
    });
    const reread = await admin
      .from('push_dispatch_config')
      .select('webhook_secret, vapid_public_key, vapid_private_key, vapid_subject')
      .eq('id', true)
      .single();
    data = reread.data;
    if (reread.error || !data) throw new Error('push config could not be created');
  }

  // Generate the VAPID pair once, atomically. A concurrent invocation either
  // wins the conditional update or reads the keys the winner stored.
  if (!data.vapid_public_key || !data.vapid_private_key) {
    const keys = webpush.generateVAPIDKeys();
    const { data: updated } = await admin
      .from('push_dispatch_config')
      .update({ vapid_public_key: keys.publicKey, vapid_private_key: keys.privateKey })
      .eq('id', true)
      .is('vapid_public_key', null)
      .select('webhook_secret, vapid_public_key, vapid_private_key, vapid_subject');

    if (updated?.length) {
      data = updated[0];
    } else {
      const reread = await admin
        .from('push_dispatch_config')
        .select('webhook_secret, vapid_public_key, vapid_private_key, vapid_subject')
        .eq('id', true)
        .single();
      data = reread.data;
    }
  }

  if (!data?.vapid_public_key || !data?.vapid_private_key) {
    throw new Error('VAPID keys unavailable');
  }

  configCache = data as PushConfig;
  return configCache;
}

function configureWebPush(config: PushConfig) {
  if (vapidConfigured) return;
  webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key!, config.vapid_private_key!);
  vapidConfigured = true;
}

// ── notification deep link ─────────────────────────────────────────────────

const TAB_VALUES = new Set([
  'my', 'incoming', 'outgoing', 'transfers', 'cash', 'agreements', 'clients',
  'capital', 'settlements', 'liquidity', 'trades', 'loans',
]);

const FOCUS_KEYS: Record<string, string> = {
  deal: 'focusDealId',
  order: 'focusOrderId',
  settlement: 'focusSettlementId',
  stock: 'focusStockId',
  approval: 'focusApprovalId',
  invite: 'focusInviteId',
  transfer: 'focusTransferId',
  capital_transfer: 'focusTransferId',
  cash_custody: 'focusCustodyId',
  agreement: 'focusAgreementId',
  customer_order: 'focusOrderId',
  customer_connection: 'focusConnectionId',
  customer_message: 'messageId',
  chat_message: 'messageId',
  capital_ledger: 'focusLedgerId',
  loan_payment_claim: 'focusLoanPaymentClaimId',
  loan_payment_claim_change: 'focusLoanPaymentClaimId',
  os_room: 'roomId',
  chat_room: 'roomId',
  message: 'messageId',
};

const LEGACY_PATHS: Record<string, string> = {
  deal: '/trading/orders',
  order: '/trading/orders',
  customer_order: '/trading/orders',
  invite: '/merchants',
  network: '/merchants',
  customer: '/merchants',
  approval: '/admin/approvals',
  message: '/chat',
  chat: '/chat',
  stock: '/trading/stock',
  agreement: '/merchants?tab=agreements',
  settlement: '/trading/orders?tab=settlements',
};

function buildNotificationPath(n: Record<string, any>): string {
  if (n.target_entity_type === 'cash_custody' || n.entity_type === 'cash_custody') {
    const id = n.target_entity_id || n.entity_id;
    const params = new URLSearchParams({ tab: 'accounts' });
    if (id) params.set('focusCustodyId', id);
    return `/trading/cash?${params.toString()}`;
  }

  const targetPath = n.target_path || LEGACY_PATHS[n.category] || '/notifications';
  const params = new URLSearchParams();

  if (n.target_tab && TAB_VALUES.has(n.target_tab)) params.set('tab', n.target_tab);

  const conversationId = n.conversation_id
    || ((n.target_entity_type === 'os_room' || n.target_entity_type === 'chat_room') ? n.target_entity_id : null);
  const messageId = n.message_id
    || (['chat_message', 'customer_message', 'message'].includes(n.target_entity_type) ? n.target_entity_id : null);

  if (targetPath === '/chat') {
    if (conversationId) {
      params.set('roomId', conversationId);
      if (messageId) params.set('messageId', messageId);
    } else if (messageId) {
      params.set('messageId', messageId);
    }
  } else if (n.target_focus && n.target_entity_id) {
    params.set(n.target_focus, n.target_entity_id);
  } else if (n.target_entity_type && n.target_entity_id && FOCUS_KEYS[n.target_entity_type]) {
    params.set(FOCUS_KEYS[n.target_entity_type], n.target_entity_id);
  }

  const query = params.toString();
  return query ? `${targetPath}${targetPath.includes('?') ? '&' : '?'}${query}` : targetPath;
}

// ── delivery preferences ───────────────────────────────────────────────────

function parseTime(value: unknown): number {
  const [h, m] = String(value ?? '0:0').split(':').map(Number);
  return ((Number.isFinite(h) ? h : 0) % 24) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesInTimezone(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function isQuietHours(settings: Record<string, any>): boolean {
  if (!settings?.dnd_enabled) return false;
  const now = minutesInTimezone(settings.timezone || 'UTC');
  const start = parseTime(settings.dnd_start);
  const end = parseTime(settings.dnd_end);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight window
}

async function skipReason(
  userId: string,
  category: string,
  options: SendOptions,
): Promise<string | null> {
  if (options.ignoreAllFilters) return null;

  const { data: settings } = await admin
    .from('notification_settings')
    .select('push_enabled, dnd_enabled, dnd_start, dnd_end, timezone')
    .eq('user_id', userId)
    .maybeSingle();

  if (settings?.push_enabled === false) return 'push_disabled';

  if (!options.ignoreQuietHours && isQuietHours(settings ?? {})) return 'quiet_hours';

  if (!options.ignoreCategory && category) {
    const { data: pref } = await admin
      .from('notification_preferences')
      .select('push_enabled')
      .eq('user_id', userId)
      .eq('category', category)
      .maybeSingle();
    if (pref?.push_enabled === false) return 'category_disabled';
  }

  return null;
}

// ── FCM ────────────────────────────────────────────────────────────────────

interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

async function getFcmAccessToken(sa: FcmServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && fcmTokenCache.expiresAt > now + 60) return fcmTokenCache.token;

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));

  const input = new TextEncoder().encode(`${header}.${payload}`);
  const pemBody = sa.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, input);
  const jwt = `${header}.${payload}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to obtain FCM access token');

  fcmTokenCache = { token: tokenData.access_token, expiresAt: now + 3300 };
  return tokenData.access_token;
}

async function sendFcm(
  tokens: Array<{ token: string; platform: string }>,
  title: string,
  body: string,
  data: Record<string, string>,
  badge: number,
): Promise<{ sent: number; stale: string[]; configured: boolean }> {
  if (!FCM_JSON) return { sent: 0, stale: [], configured: false };
  if (!tokens.length) return { sent: 0, stale: [], configured: true };

  let sa: FcmServiceAccount;
  try {
    sa = JSON.parse(FCM_JSON);
  } catch {
    console.error('[push-send] FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
    return { sent: 0, stale: [], configured: false };
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken(sa);
  } catch (err) {
    console.error('[push-send] FCM auth failed:', err);
    return { sent: 0, stale: [], configured: false };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let sent = 0;
  const stale: string[] = [];

  for (const { token, platform } of tokens) {
    const message: Record<string, unknown> = {
      token,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { channel_id: 'default', sound: 'default' },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: Math.max(1, badge), 'content-available': 1 } },
      },
    };

    if (platform === 'ios') delete message.android;
    if (platform === 'android') delete message.apns;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (res.ok) {
        sent++;
        continue;
      }

      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.[0]?.errorCode ?? err?.error?.status ?? err?.error?.code;
      if (['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH'].includes(String(code))) {
        stale.push(token);
      }
      console.error('[push-send] FCM error:', code, token.slice(0, 10));
    } catch (err) {
      console.error('[push-send] FCM request failed:', err);
    }
  }

  return { sent, stale, configured: true };
}

// ── core delivery ──────────────────────────────────────────────────────────

async function deliver(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
  category: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const config = await getConfig();
  const skipped = await skipReason(userId, category, options);
  if (skipped) {
    return { web: 0, native: 0, skipped, stale_removed: 0, fcm_configured: Boolean(FCM_JSON) };
  }

  const [tokenResult, subResult, badgeResult] = await Promise.all([
    admin.from('push_device_tokens').select('token, platform, active_until').eq('user_id', userId),
    admin.from('web_push_subscriptions').select('endpoint, p256dh, auth, active_until').eq('user_id', userId),
    admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
  ]);

  const now = Date.now();
  const isActive = (row: { active_until?: string | null }) =>
    Boolean(row.active_until && new Date(row.active_until).getTime() > now);

  const allTokens = (tokenResult.data ?? []) as Array<{ token: string; platform: string; active_until: string | null }>;
  const allSubscriptions = (subResult.data ?? []) as Array<{ endpoint: string; p256dh: string; auth: string; active_until: string | null }>;

  // A device that is actively showing the app already receives the in-app
  // alert, so it does not need an OS notification. Calls and tests bypass this.
  const tokens = options.ignorePresence ? allTokens : allTokens.filter((t) => !isActive(t));
  const subscriptions = options.ignorePresence ? allSubscriptions : allSubscriptions.filter((s) => !isActive(s));
  const suppressedByPresence = (allTokens.length + allSubscriptions.length) - (tokens.length + subscriptions.length);

  const badge = badgeResult.count ?? 1;

  // Web Push
  let webSent = 0;
  const staleEndpoints: string[] = [];
  if (subscriptions.length) {
    configureWebPush(config);
    const payload = JSON.stringify({ title, body, data, badge, tag: data.notification_id || 'tracker' });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: category === 'message' ? 'normal' : 'high' },
        );
        webSent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.error('[push-send] Web push error:', err?.statusCode, err?.body ?? err?.message);
        }
      }
    }

    if (staleEndpoints.length) {
      await admin.from('web_push_subscriptions').delete().in('endpoint', staleEndpoints);
    }
  }

  // Native Push
  const fcm = await sendFcm(tokens, title, body, data, badge);
  if (fcm.stale.length) {
    await admin.from('push_device_tokens').delete().in('token', fcm.stale);
  }

  return {
    web: webSent,
    native: fcm.sent,
    skipped: suppressedByPresence > 0 && !webSent && !fcm.sent ? 'app_active' : undefined,
    stale_removed: staleEndpoints.length + fcm.stale.length,
    fcm_configured: fcm.configured,
  };
}

// ── request handling ───────────────────────────────────────────────────────

async function authenticate(req: Request): Promise<string | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    // The VAPID public key is safe to expose; the browser needs it to subscribe.
    if (action === 'public_key') {
      const config = await getConfig();
      return json({ public_key: config.vapid_public_key });
    }

    const config = await getConfig();
    const isInternal = safeEqual(req.headers.get('x-push-secret'), config.webhook_secret);
    const userId = isInternal ? null : await authenticate(req);

    if (!isInternal && !userId) return json({ error: 'unauthorized' }, 401);

    if (action === 'test') {
      if (!userId) return json({ error: 'test requires a user session' }, 400);
      const result = await deliver(
        userId,
        'The Tracker test notification',
        'Push notifications are working on this device.',
        { path: '/notifications', notification_id: '', category: 'system' },
        'system',
        { ignoreAllFilters: true, ignorePresence: true },
      );
      return json({ ok: true, ...result });
    }

    if (action === 'call') {
      if (!userId) return json({ error: 'call requires a user session' }, 400);
      const roomId = String(body?.room_id ?? '');
      const callId = String(body?.call_id ?? '');
      if (!roomId) return json({ error: 'room_id required' }, 400);

      const { data: members } = await admin
        .from('chat_room_members')
        .select('user_id')
        .eq('room_id', roomId)
        .is('removed_at', null);

      const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
      if (!memberIds.includes(userId)) return json({ error: 'not a room member' }, 403);

      const results = [];
      for (const target of memberIds.filter((id) => id !== userId)) {
        results.push(await deliver(
          target,
          '📞 Incoming call',
          'Someone is calling you',
          {
            type: 'incoming_call',
            call_id: callId,
            room_id: roomId,
            path: `/chat?roomId=${encodeURIComponent(roomId)}`,
            category: 'message',
          },
          'message',
          { ignoreQuietHours: true, ignorePresence: true, ignoreCategory: true },
        ));
      }
      return json({ ok: true, recipients: results.length, results });
    }

    // Everything below is server-to-server. A signed-in user must never be
    // able to push arbitrary content to another account.
    if (!isInternal) return json({ error: 'forbidden' }, 403);

    let title: string;
    let bodyText: string;
    let category: string;
    let data: Record<string, string>;

    if (body?.notification_id) {
      const { data: notification, error } = await admin
        .from('notifications')
        .select('*')
        .eq('id', String(body.notification_id))
        .maybeSingle();

      if (error) throw error;
      if (!notification) return json({ error: 'notification not found' }, 404);

      title = notification.title || 'The Tracker';
      bodyText = notification.body || '';
      category = notification.category || 'system';
      data = {
        notification_id: notification.id,
        path: buildNotificationPath(notification),
        category,
      };
      if (notification.conversation_id) data.conversation_id = notification.conversation_id;
      if (notification.message_id) data.message_id = notification.message_id;

      const result = await deliver(notification.user_id, title, bodyText, data, category);
      return json({ ok: true, ...result });
    }

    // Legacy/internal explicit payload.
    if (!body?.user_id || !body?.title) return json({ error: 'user_id and title required' }, 400);
    title = String(body.title);
    bodyText = String(body.body ?? '');
    category = String(body.data?.category ?? 'system');
    data = Object.fromEntries(
      Object.entries(body.data ?? {}).map(([k, v]) => [k, String(v)]),
    );

    const result = await deliver(String(body.user_id), title, bodyText, data, category);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('[push-send] Error:', err);
    return json({ error: String(err) }, 500);
  }
});
