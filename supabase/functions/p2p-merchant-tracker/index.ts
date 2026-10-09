import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c";

/** A merchant counts as online when Binance reports activity this recently. */
const ONLINE_WITHIN_SECONDS = 180;
/** A merchant polled more recently than this is not asked about again. */
const USER_THROTTLE_MS = 20_000;
const CRON_THROTTLE_MS = 45_000;
const KEEP_DAYS = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

/** Binance merchant ids look like "s" + 32 hex characters. */
const USER_NO = /\bs[0-9a-f]{32}\b/i;

async function fetchProfile(userNo: string): Promise<Any | null> {
  const res = await fetch(`${BASE}/user/profile-and-ads-list?userNo=${encodeURIComponent(userNo)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.data?.userDetailVo ?? null;
}

function toSnapshot(userNo: string, d: Any) {
  const stats = d.userStatsRet ?? {};
  const active = Number.isFinite(Number(d.activeTimeInSecond)) ? Number(d.activeTimeInSecond) : null;
  const lastActive = Number(d.lastActiveTime);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
  return {
    user_no: userNo,
    online: active !== null && active <= ONLINE_WITHIN_SECONDS,
    active_seconds: active,
    last_active_at: Number.isFinite(lastActive) && lastActive > 0 ? new Date(lastActive).toISOString() : null,
    total_orders: num(stats.completedOrderNum ?? d.orderCount),
    sell_orders: num(stats.completedSellOrderNum),
    buy_orders: num(stats.completedBuyOrderNum),
    month_orders: num(stats.completedOrderNumOfLatest30day ?? d.monthOrderCount),
    month_sell_orders: num(stats.completedSellOrderNumOfLatest30day),
    finish_rate: num(stats.finishRateLatest30day ?? d.monthFinishRate),
  };
}

interface Candidate { userNo: string; nick: string; monthOrders: number | null }

/**
 * Finds a merchant in the live ad lists, since Binance has no public nickname
 * lookup. Binance masks counterparty names in order history ("Jos***"), so a
 * nickname is matched three ways: by the ad number of an order you traded on
 * (exact, when that ad is still listed), by a full nickname, or by the visible
 * first letters of a masked one (possibly several merchants).
 */
async function findMerchant(query: string, advNos: string[]): Promise<{ exact: Candidate | null; candidates: Candidate[] }> {
  const wanted = query.trim().toLowerCase();
  const masked = wanted.endsWith("*");
  const prefix = wanted.replace(/\*+$/, "");
  const adSet = new Set(advNos.map(String));
  const lists: Array<{ fiat: string; tradeType: "BUY" | "SELL" }> = [];
  for (const fiat of ["EGP", "QAR"]) for (const tradeType of ["BUY", "SELL"] as const) lists.push({ fiat, tradeType });

  const found = new Map<string, Candidate>();
  let exact: Candidate | null = null;

  const scan = async ({ fiat, tradeType }: { fiat: string; tradeType: "BUY" | "SELL" }) => {
    for (let page = 1; page <= 10 && !exact; page++) {
      const res = await fetch(`${BASE}/adv/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiat, page, rows: 20, tradeType, asset: "USDT", countries: [], proMerchantAds: false,
          shieldMerchantAds: false, publisherType: null, payTypes: [],
        }),
      });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      const rows: Any[] = body?.data ?? [];
      if (rows.length === 0) return;
      for (const r of rows) {
        const a = r?.advertiser;
        if (!a?.userNo) continue;
        const cand: Candidate = { userNo: String(a.userNo), nick: String(a.nickName ?? ""), monthOrders: Number.isFinite(Number(a.monthOrderCount)) ? Number(a.monthOrderCount) : null };
        if (adSet.size > 0 && adSet.has(String(r?.adv?.advNo))) { exact = cand; return; }
        const nick = cand.nick.trim().toLowerCase();
        if (masked ? prefix.length >= 2 && nick.startsWith(prefix) : nick === wanted) found.set(cand.userNo, cand);
      }
    }
  };

  await Promise.all(lists.map(scan));
  const candidates = [...found.values()].sort((a, b) => (b.monthOrders ?? 0) - (a.monthOrders ?? 0));
  return { exact, candidates };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? "poll-all");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = bearer ? await supabase.auth.getUser(bearer) : { data: { user: null } };
    const userId = userData?.user?.id ?? null;

    const latestTs = async (userNo: string): Promise<number> => {
      const { data } = await supabase.from("p2p_merchant_snapshots").select("ts").eq("user_no", userNo)
        .order("ts", { ascending: false }).limit(1).maybeSingle();
      return data?.ts ? new Date(data.ts).getTime() : 0;
    };

    const pollMany = async (userNos: string[], throttleMs: number) => {
      const polled: string[] = [];
      const failed: string[] = [];
      await Promise.all(userNos.map(async (userNo) => {
        if (Date.now() - (await latestTs(userNo)) < throttleMs) return;
        const profile = await fetchProfile(userNo).catch(() => null);
        if (!profile) { failed.push(userNo); return; }
        const { error } = await supabase.from("p2p_merchant_snapshots").insert(toSnapshot(userNo, profile));
        if (error) failed.push(userNo); else polled.push(userNo);
      }));
      return { polled: polled.length, failed: failed.length };
    };

    // ── Find a merchant from a nickname, a merchant id, or a pasted profile link ──
    if (action === "resolve") {
      if (!userId) return json({ error: "Sign in first" }, 401);
      const query = String(body.query ?? "").trim();
      if (!query) return json({ error: "Enter a nickname, merchant id or profile link" }, 400);
      const idMatch = query.match(USER_NO);
      if (idMatch) {
        const profile = await fetchProfile(idMatch[0]);
        if (!profile) return json({ error: "No Binance merchant with that id" }, 404);
        return json({ userNo: idMatch[0], nick: String(profile.nickName ?? idMatch[0]) });
      }
      const advNos = Array.isArray(body.advNos) ? body.advNos.map(String).slice(0, 40) : [];
      const { exact, candidates } = await findMerchant(query, advNos);
      if (exact) return json({ userNo: exact.userNo, nick: exact.nick });
      if (candidates.length === 1) return json({ userNo: candidates[0].userNo, nick: candidates[0].nick });
      if (candidates.length > 1) return json({ candidates: candidates.slice(0, 12) });
      return json({
        error: "not_found",
        message: "Binance only shows merchants who have an ad listed right now, and your order history hides their full name. Paste their profile link or merchant id instead.",
      }, 404);
    }

    // ── A user's own watchlist, read now ──
    if (action === "refresh") {
      if (!userId) return json({ error: "Sign in first" }, 401);
      const { data: rows } = await supabase.from("p2p_watched_merchants").select("user_no").eq("user_id", userId);
      const result = await pollMany([...new Set((rows ?? []).map((r: Any) => r.user_no as string))], USER_THROTTLE_MS);
      return json({ ok: true, ...result });
    }

    // ── Everyone's watchlist, on the schedule ──
    if (action === "poll-all") {
      const { data: rows } = await supabase.from("p2p_watched_merchants").select("user_no");
      const result = await pollMany([...new Set((rows ?? []).map((r: Any) => r.user_no as string))], CRON_THROTTLE_MS);
      await supabase.from("p2p_merchant_snapshots").delete()
        .lt("ts", new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString());
      return json({ ok: true, ...result, at: new Date().toISOString() });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
