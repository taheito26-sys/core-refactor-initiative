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
/** When each user's waiting merchants were last looked for (per function instance, best effort). */
const lastPendingScan = new Map<string, number>();

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
interface AdEntry extends Candidate { advNo: string }

/** Every USDT ad currently listed in these currencies, both sides. Binance has no public merchant lookup, so this is how a merchant is found. */
async function scanAds(fiats: string[], stopWhen?: (e: AdEntry) => boolean): Promise<AdEntry[]> {
  const lists: Array<{ fiat: string; tradeType: "BUY" | "SELL" }> = [];
  for (const fiat of fiats) for (const tradeType of ["BUY", "SELL"] as const) lists.push({ fiat, tradeType });
  const entries: AdEntry[] = [];
  let stop = false;

  const scan = async ({ fiat, tradeType }: { fiat: string; tradeType: "BUY" | "SELL" }) => {
    // The Egypt sell list alone runs to 17 pages of 20.
    for (let page = 1; page <= 30 && !stop; page++) {
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
        const entry: AdEntry = {
          advNo: String(r?.adv?.advNo ?? ""),
          userNo: String(a.userNo),
          nick: String(a.nickName ?? ""),
          monthOrders: Number.isFinite(Number(a.monthOrderCount)) ? Number(a.monthOrderCount) : null,
        };
        entries.push(entry);
        if (stopWhen?.(entry)) { stop = true; return; }
      }
    }
  };

  await Promise.all(lists.map(scan));
  return entries;
}

/**
 * Matches a merchant among listed ads. Binance masks counterparty names in
 * order history ("Jos***"), so a request matches by the ad number of an order
 * you traded on (exact, when that ad is still listed), by a full nickname, or
 * by the visible first letters of a masked one (possibly several merchants).
 */
function matchMerchant(entries: AdEntry[], query: string, advNos: string[]): { exact: Candidate | null; candidates: Candidate[] } {
  const wanted = query.trim().toLowerCase();
  const masked = wanted.endsWith("*");
  const prefix = wanted.replace(/\*+$/, "");
  const adSet = new Set(advNos.map(String).filter(Boolean));
  const byAd = adSet.size > 0 ? entries.find((e) => adSet.has(e.advNo)) : undefined;
  if (byAd) return { exact: byAd, candidates: [] };
  const found = new Map<string, Candidate>();
  for (const e of entries) {
    const nick = e.nick.trim().toLowerCase();
    if (masked ? prefix.length >= 2 && nick.startsWith(prefix) : nick === wanted) found.set(e.userNo, e);
  }
  return { exact: null, candidates: [...found.values()].sort((x, y) => (y.monthOrders ?? 0) - (x.monthOrders ?? 0)) };
}

const fiatList = (extra: unknown): string[] => {
  const more = Array.isArray(extra) ? extra.map((f) => String(f).toUpperCase()).filter((f) => /^[A-Z]{3}$/.test(f)) : [];
  return [...new Set(["EGP", "QAR", ...more])].slice(0, 6);
};

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

    /** Identifies waiting merchants (no id yet) from the ads listed right now; one ad scan serves all of them. */
    const resolvePending = async (userId?: string): Promise<number> => {
      let q = supabase.from("p2p_watched_merchants").select("id, user_id, nick, pending_query, adv_nos, fiats").is("user_no", null);
      if (userId) q = q.eq("user_id", userId);
      const { data: pending } = await q;
      if (!pending || pending.length === 0) return 0;
      const fiats = fiatList((pending as Any[]).flatMap((p) => p.fiats ?? []));
      const entries = await scanAds(fiats);
      let resolved = 0;
      for (const row of pending as Any[]) {
        const { exact, candidates } = matchMerchant(entries, String(row.pending_query ?? row.nick), row.adv_nos ?? []);
        const hit = exact ?? (candidates.length === 1 ? candidates[0] : null);
        if (!hit) continue;
        const { error } = await supabase.from("p2p_watched_merchants")
          .update({ user_no: hit.userNo, nick: hit.nick, pending_query: null }).eq("id", row.id);
        if (error) {
          // Already following this merchant under another entry: drop the duplicate.
          await supabase.from("p2p_watched_merchants").delete().eq("id", row.id);
        } else resolved++;
      }
      return resolved;
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
      const adSet = new Set(advNos);
      const entries = await scanAds(fiatList(body.fiats), adSet.size > 0 ? (e) => adSet.has(e.advNo) : undefined);
      const { exact, candidates } = matchMerchant(entries, query, advNos);
      if (exact) return json({ userNo: exact.userNo, nick: exact.nick });
      if (candidates.length === 1) return json({ userNo: candidates[0].userNo, nick: candidates[0].nick });
      if (candidates.length > 1) return json({ candidates: candidates.slice(0, 12) });
      // Not listed right now: the caller keeps the request and the poller identifies the merchant later.
      return json({
        notListed: true,
        message: "This merchant has no ad listed right now, so Binance does not show them yet. They are on your list and will start being tracked as soon as they list an ad.",
      });
    }

    // ── A user's own watchlist, read now ──
    if (action === "refresh") {
      if (!userId) return json({ error: "Sign in first" }, 401);
      // Waiting merchants are looked for at most once a minute (an ad scan is dozens of requests).
      if (Date.now() - (lastPendingScan.get(userId) ?? 0) > 60_000) {
        lastPendingScan.set(userId, Date.now());
        await resolvePending(userId).catch((err) => console.warn("resolvePending failed", err));
      }
      const { data: rows } = await supabase.from("p2p_watched_merchants").select("user_no").eq("user_id", userId).not("user_no", "is", null);
      const result = await pollMany([...new Set((rows ?? []).map((r: Any) => r.user_no as string))], USER_THROTTLE_MS);
      return json({ ok: true, ...result });
    }

    // ── Everyone's watchlist, on the schedule ──
    if (action === "poll-all") {
      await resolvePending().catch((err) => console.warn("resolvePending failed", err));
      const { data: rows } = await supabase.from("p2p_watched_merchants").select("user_no").not("user_no", "is", null);
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
