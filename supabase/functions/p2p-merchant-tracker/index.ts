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

/** Binance's own hosts only: a pasted link is fetched server side, so anything else is refused. */
const isBinanceHost = (host: string) => /(^|\.)(binance\.(com|me|info|cc)|bnbstatic\.com)$/i.test(host);

/**
 * Finds a merchant id in a pasted link. A profile link carries it directly.
 * The app's share links (binance.com/en/qr/...) sit behind bot protection that
 * blocks ordinary clients, but answer a link-preview crawler with a plain
 * redirect to the profile page, which names the merchant. Redirects are
 * followed one hop at a time and only within Binance's own hosts.
 */
async function merchantIdFromLink(link: string): Promise<string | null> {
  const direct = link.match(USER_NO)?.[0];
  if (direct) return direct;
  let current = link;
  for (let hop = 0; hop < 5; hop++) {
    let url: URL;
    try { url = new URL(current); } catch { return null; }
    if (url.protocol !== "https:" || !isBinanceHost(url.hostname)) return null;
    const res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": "WhatsApp/2.23.20.0 A", Accept: "text/html,*/*" },
    }).catch(() => null);
    if (!res) return null;
    const location = res.headers.get("location");
    if (location) {
      const id = decodeURIComponent(location).match(USER_NO)?.[0];
      if (id) return id;
      current = new URL(location, url).toString();
      continue;
    }
    const text = (await res.text().catch(() => "")).slice(0, 300_000);
    return decodeURIComponent(text).match(USER_NO)?.[0] ?? null;
  }
  return null;
}

/** Escapes a value for ilike so "_" and "%" in a nickname match themselves. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

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

    /** Remembers the ads seen, so merchants can be identified later without waiting for them to list again. */
    const learn = async (entries: AdEntry[]) => {
      const rows = new Map<string, Any>();
      for (const e of entries) {
        if (!e.advNo || !e.userNo) continue;
        rows.set(e.advNo, { adv_no: e.advNo, user_no: e.userNo, nick: e.nick, month_orders: e.monthOrders, last_seen: new Date().toISOString() });
      }
      const all = [...rows.values()];
      for (let i = 0; i < all.length; i += 500) {
        const { error } = await supabase.from("p2p_merchant_ads").upsert(all.slice(i, i + 500), { onConflict: "adv_no" });
        if (error) { console.warn("learn failed", error.message); return; }
      }
    };

    /** Looks a request up among every ad ever recorded, including merchants with no ad today. */
    const lookupDirectory = async (query: string, advNos: string[]): Promise<{ exact: Candidate | null; candidates: Candidate[] }> => {
      const toCandidate = (r: Any): Candidate => ({ userNo: r.user_no, nick: r.nick, monthOrders: r.month_orders ?? null });
      const ads = advNos.map(String).filter(Boolean);
      if (ads.length > 0) {
        const { data } = await supabase.from("p2p_merchant_ads").select("user_no, nick, month_orders").in("adv_no", ads).limit(1);
        if (data && data.length > 0) return { exact: toCandidate(data[0]), candidates: [] };
      }
      const wanted = query.trim();
      const masked = wanted.endsWith("*");
      const prefix = wanted.replace(/\*+$/, "");
      if (masked && prefix.length < 2) return { exact: null, candidates: [] };
      const { data } = await supabase.from("p2p_merchant_ads").select("user_no, nick, month_orders")
        .ilike("nick", masked ? `${likeEscape(prefix)}%` : likeEscape(wanted)).limit(200);
      const byUser = new Map<string, Candidate>();
      for (const r of data ?? []) byUser.set(r.user_no, toCandidate(r));
      return { exact: null, candidates: [...byUser.values()].sort((a, b) => (b.monthOrders ?? 0) - (a.monthOrders ?? 0)) };
    };

    /** Identifies waiting merchants (no id yet) from every ad recorded, which the scheduled scan keeps current. */
    const resolvePending = async (userId?: string): Promise<number> => {
      let q = supabase.from("p2p_watched_merchants").select("id, user_id, nick, pending_query, adv_nos").is("user_no", null);
      if (userId) q = q.eq("user_id", userId);
      const { data: pending } = await q;
      if (!pending || pending.length === 0) return 0;
      let resolved = 0;
      for (const row of pending as Any[]) {
        const { exact, candidates } = await lookupDirectory(String(row.pending_query ?? row.nick), row.adv_nos ?? []);
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
      // A share message may wrap the link in text; use the first link in it.
      const pastedLink = query.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? query;
      const linkedId = /^https?:\/\//i.test(pastedLink) || USER_NO.test(query) ? await merchantIdFromLink(pastedLink) : null;
      if (linkedId) {
        const profile = await fetchProfile(linkedId);
        if (!profile) return json({ error: "No Binance merchant with that id" }, 404);
        return json({ userNo: linkedId, nick: String(profile.nickName ?? linkedId) });
      }
      if (/^https?:\/\//i.test(pastedLink)) {
        return json({ error: "I could not find a merchant id in that link. Open the merchant's profile in Binance, tap Share, and copy the profile link." }, 404);
      }
      const advNos = Array.isArray(body.advNos) ? body.advNos.map(String).slice(0, 40) : [];
      // Merchants seen advertising before are found at once, even with no ad today.
      const known = await lookupDirectory(query, advNos);
      if (known.exact) return json({ userNo: known.exact.userNo, nick: known.exact.nick });
      if (known.candidates.length === 1) return json({ userNo: known.candidates[0].userNo, nick: known.candidates[0].nick });
      const adSet = new Set(advNos);
      const entries = await scanAds(fiatList(body.fiats), adSet.size > 0 ? (e) => adSet.has(e.advNo) : undefined);
      await learn(entries);
      const live = matchMerchant(entries, query, advNos);
      if (live.exact) return json({ userNo: live.exact.userNo, nick: live.exact.nick });
      const merged = new Map<string, Candidate>();
      for (const c of [...known.candidates, ...live.candidates]) merged.set(c.userNo, c);
      const candidates = [...merged.values()].sort((a, b) => (b.monthOrders ?? 0) - (a.monthOrders ?? 0));
      if (candidates.length === 1) return json({ userNo: candidates[0].userNo, nick: candidates[0].nick });
      if (candidates.length > 1) return json({ candidates: candidates.slice(0, 12) });
      // Never seen advertising: the caller keeps the request, and it is identified when they list an ad or a profile link is pasted.
      return json({
        notListed: true,
        message: "Binance only reveals a merchant's id while they advertise, and this one has not been seen advertising yet. Paste their profile link to start now, or they will be picked up when they next list an ad.",
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
      // One scan of the listed ads keeps the directory current and lets waiting merchants be identified.
      await scanAds(fiatList([])).then(learn).catch((err) => console.warn("directory scan failed", err));
      await resolvePending().catch((err) => console.warn("resolvePending failed", err));
      const { data: rows } = await supabase.from("p2p_watched_merchants").select("user_no").not("user_no", "is", null);
      const result = await pollMany([...new Set((rows ?? []).map((r: Any) => r.user_no as string))], CRON_THROTTLE_MS);
      await supabase.from("p2p_merchant_snapshots").delete()
        .lt("ts", new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString());
      await supabase.from("p2p_merchant_ads").delete()
        .lt("last_seen", new Date(Date.now() - 365 * 86400_000).toISOString());
      return json({ ok: true, ...result, at: new Date().toISOString() });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
