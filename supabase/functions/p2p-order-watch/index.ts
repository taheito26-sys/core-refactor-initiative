/**
 * p2p-order-watch: tells a merchant loudly that a Binance P2P order is open.
 *
 * Callers
 * - pg_cron every 20 seconds, action "poll" (no session): checks every merchant
 *   who turned the alert on.
 * - the app, action "check" (user JWT): checks the caller now and reports
 *   whether the Binance key works.
 * - the service worker, action "ack" (alert id + ack token from the push
 *   payload): the Acknowledge button on the notification itself.
 *
 * A new open order is pushed at once, then again every 2 minutes until the
 * merchant acknowledges it or Binance reports it closed. Only alert rows are
 * written; the tracker, stock and cash data are never touched.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  alertMessage,
  isOpenOrderStatus,
  isReminderDue,
  LOOKBACK_MS,
  toAlertOrder,
  type AlertOrder,
} from "../_shared/p2pOrderAlert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** A merchant checked more recently than this is skipped, so extra calls cannot hammer Binance. */
const MIN_CHECK_GAP_MS = 15_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function binanceOrders(apiKey: string, apiSecret: string, tradeType: "BUY" | "SELL"): Promise<Any[]> {
  const endTimestamp = Date.now();
  const query = new URLSearchParams({
    tradeType,
    page: "1",
    rows: "50",
    startTimestamp: String(endTimestamp - LOOKBACK_MS),
    endTimestamp: String(endTimestamp),
    timestamp: String(endTimestamp),
    recvWindow: "10000",
  });
  query.set("signature", await hmacSha256Hex(apiSecret, query.toString()));
  const res = await fetch(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Binance ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return Array.isArray(body?.data) ? body.data : [];
}

let pushSecret: string | null = null;
async function sendPush(userId: string, alert: Any, order: AlertOrder, pushCount: number) {
  if (!pushSecret) {
    const { data } = await admin.from("push_dispatch_config").select("webhook_secret").eq("id", true).maybeSingle();
    pushSecret = data?.webhook_secret ?? null;
  }
  if (!pushSecret) return;
  const { title, body } = alertMessage(order, pushCount);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-push-secret": pushSecret },
    body: JSON.stringify({
      user_id: userId,
      title,
      body,
      urgent: true,
      data: {
        category: "p2p_order_alert",
        path: "/trading/orders",
        p2p_alert_id: alert.id,
        p2p_ack_token: alert.ack_token,
        order_number: order.order_number,
        functions_url: `${SUPABASE_URL}/functions/v1`,
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.error("[p2p-order-watch] push failed", res.status, await res.text().catch(() => ""));
}

interface CheckResult { ok: boolean; open: number; pushed: number; error?: string }

async function checkUser(userId: string): Promise<CheckResult> {
  const now = Date.now();
  await admin.from("p2p_order_watch").update({ last_checked_at: new Date(now).toISOString() }).eq("user_id", userId);

  const { data: cred } = await admin
    .from("exchange_credentials")
    .select("api_key, api_secret")
    .eq("user_id", userId)
    .eq("exchange", "binance")
    .maybeSingle();
  if (!cred) {
    const error = "No Binance account connected";
    await admin.from("p2p_order_watch").update({ last_error: error }).eq("user_id", userId);
    return { ok: false, open: 0, pushed: 0, error };
  }

  let open: AlertOrder[];
  try {
    const [buys, sells] = await Promise.all([
      binanceOrders(cred.api_key, cred.api_secret, "BUY"),
      binanceOrders(cred.api_key, cred.api_secret, "SELL"),
    ]);
    open = [
      ...buys.map((o) => ({ raw: o, side: "BUY" as const })),
      ...sells.map((o) => ({ raw: o, side: "SELL" as const })),
    ]
      .filter(({ raw }) => isOpenOrderStatus(raw?.orderStatus ?? raw?.status))
      .map(({ raw, side }) => toAlertOrder(raw, side))
      .filter((o): o is AlertOrder => o !== null);
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 300);
    await admin.from("p2p_order_watch").update({ last_error: error }).eq("user_id", userId);
    return { ok: false, open: 0, pushed: 0, error };
  }

  await admin.from("p2p_order_watch")
    .update({ last_ok_at: new Date().toISOString(), last_error: null })
    .eq("user_id", userId);

  // Record any newly seen open order; existing rows only get their status refreshed.
  if (open.length) {
    await admin.from("p2p_order_alerts").upsert(
      open.map((o) => ({ user_id: userId, exchange: "binance", ...o })),
      { onConflict: "user_id,exchange,order_number", ignoreDuplicates: true },
    );
    for (const o of open) {
      await admin.from("p2p_order_alerts")
        .update({ order_status: o.order_status })
        .eq("user_id", userId).eq("exchange", "binance").eq("order_number", o.order_number)
        .neq("order_status", o.order_status);
    }
  }

  const { data: alerts } = await admin
    .from("p2p_order_alerts")
    .select("*")
    .eq("user_id", userId)
    .eq("exchange", "binance")
    .is("resolved_at", null);

  const openNumbers = new Set(open.map((o) => o.order_number));
  const closed = (alerts ?? []).filter((a: Any) => !openNumbers.has(a.order_number)).map((a: Any) => a.id);
  if (closed.length) {
    await admin.from("p2p_order_alerts").update({ resolved_at: new Date().toISOString() }).in("id", closed);
  }

  let pushed = 0;
  for (const alert of alerts ?? []) {
    if (!openNumbers.has(alert.order_number) || alert.acknowledged_at) continue;
    if (!isReminderDue(alert.last_pushed_at, Date.now())) continue;
    // Claim this push atomically so two overlapping runs cannot both send it.
    let claim = admin.from("p2p_order_alerts")
      .update({ last_pushed_at: new Date().toISOString(), push_count: (alert.push_count ?? 0) + 1 })
      .eq("id", alert.id)
      .is("acknowledged_at", null);
    claim = alert.last_pushed_at ? claim.eq("last_pushed_at", alert.last_pushed_at) : claim.is("last_pushed_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) continue;
    const order = open.find((o) => o.order_number === alert.order_number)!;
    await sendPush(userId, alert, order, alert.push_count ?? 0);
    pushed++;
  }

  return { ok: true, open: open.length, pushed };
}

async function pollAll() {
  const cutoff = new Date(Date.now() - MIN_CHECK_GAP_MS).toISOString();
  const { data: watches, error } = await admin
    .from("p2p_order_watch")
    .select("user_id")
    .eq("enabled", true)
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);
  if (error) throw error;
  const results = await Promise.allSettled((watches ?? []).map((w: Any) => checkUser(w.user_id)));
  return { checked: results.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "poll");

    if (action === "ack") {
      const id = String(body?.alert_id ?? "");
      const token = String(body?.token ?? "");
      if (!id || token.length < 32) return json({ error: "alert_id and token required" }, 400);
      const { data } = await admin.from("p2p_order_alerts")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("id", id).eq("ack_token", token).is("acknowledged_at", null)
        .select("id");
      return json({ ok: true, acknowledged: data?.length ?? 0 });
    }

    if (action === "check") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
      const userId = userData?.user?.id;
      if (!userId) return json({ error: "unauthorized" }, 401);
      return json(await checkUser(userId));
    }

    return json({ ok: true, ...(await pollAll()) });
  } catch (err) {
    console.error("[p2p-order-watch]", err);
    return json({ error: String(err) }, 500);
  }
});
