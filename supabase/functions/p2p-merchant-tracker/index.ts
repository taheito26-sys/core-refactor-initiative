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

    /**
     * What this user's own order history says about whose ad is whose. Binance marks each order with the
     * user's role: on a MAKER order the ad number is the user's OWN ad, so it must never be used to find
     * a counterparty. An ad number that turns up against several different counterparties is also the
     * user's own. Only a TAKER order's ad number points at the merchant on the other side.
     */
    const ordersContext = async (userId: string) => {
      const rows: Any[] = [];
      for (let from = 0; from < 3000; from += 1000) {
        const { data } = await supabase.from("exchange_p2p_orders")
          .select("counterparty, advNo:raw->>advNo, role:raw->>advertisementRole")
          .eq("user_id", userId).eq("exchange", "binance").range(from, from + 999);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const own = new Set<string>();
      const counterpartiesOfAd = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!r.advNo) continue;
        if (String(r.role).toUpperCase() === "MAKER") own.add(String(r.advNo));
        const set = counterpartiesOfAd.get(String(r.advNo)) ?? new Set<string>();
        set.add(String(r.counterparty ?? ""));
        counterpartiesOfAd.set(String(r.advNo), set);
      }
      for (const [ad, set] of counterpartiesOfAd) if (set.size > 1) own.add(ad);
      const adsByCounterparty = new Map<string, string[]>();
      for (const r of rows) {
        if (!r.advNo || own.has(String(r.advNo)) || !r.counterparty) continue;
        const list = adsByCounterparty.get(String(r.counterparty)) ?? [];
        if (!list.includes(String(r.advNo))) list.push(String(r.advNo));
        adsByCounterparty.set(String(r.counterparty), list);
      }
      return { ownAdvNos: own, adsByCounterparty };
    };

    /** The merchant ids behind the user's own ads, so the user is never offered or matched as a counterparty. */
    const selfUserNos = async (ownAdvNos: Set<string>, liveEntries: AdEntry[] = []): Promise<Set<string>> => {
      const ids = new Set<string>();
      for (const e of liveEntries) if (ownAdvNos.has(e.advNo)) ids.add(e.userNo);
      const ads = [...ownAdvNos];
      for (let i = 0; i < ads.length; i += 200) {
        const { data } = await supabase.from("p2p_merchant_ads").select("user_no").in("adv_no", ads.slice(i, i + 200));
        for (const r of data ?? []) ids.add(r.user_no);
      }
      return ids;
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
    const lookupDirectory = async (query: string, advNos: string[], exclude: Set<string> = new Set()): Promise<{ exact: Candidate | null; candidates: Candidate[] }> => {
      const toCandidate = (r: Any): Candidate => ({ userNo: r.user_no, nick: r.nick, monthOrders: r.month_orders ?? null });
      const ads = advNos.map(String).filter(Boolean);
      if (ads.length > 0) {
        const { data } = await supabase.from("p2p_merchant_ads").select("user_no, nick, month_orders").in("adv_no", ads);
        const hit = (data ?? []).find((r: Any) => !exclude.has(r.user_no));
        if (hit) return { exact: toCandidate(hit), candidates: [] };
      }
      const wanted = query.trim();
      const masked = wanted.endsWith("*");
      const prefix = wanted.replace(/\*+$/, "");
      if (masked && prefix.length < 2) return { exact: null, candidates: [] };
      const { data } = await supabase.from("p2p_merchant_ads").select("user_no, nick, month_orders")
        .ilike("nick", masked ? `${likeEscape(prefix)}%` : likeEscape(wanted)).limit(200);
      const byUser = new Map<string, Candidate>();
      for (const r of data ?? []) if (!exclude.has(r.user_no)) byUser.set(r.user_no, toCandidate(r));
      return { exact: null, candidates: [...byUser.values()].sort((a, b) => (b.monthOrders ?? 0) - (a.monthOrders ?? 0)) };
    };

    /**
     * Identifies waiting merchants (no id yet). Only firm evidence counts: an ad number from a trade where the
     * user was the taker, or a full nickname with exactly one match. Letters alone are never enough here.
     */
    const resolvePending = async (userId?: string): Promise<number> => {
      let q = supabase.from("p2p_watched_merchants").select("id, user_id, nick, pending_query").is("user_no", null);
      if (userId) q = q.eq("user_id", userId);
      const { data: pending } = await q;
      if (!pending || pending.length === 0) return 0;
      const contexts = new Map<string, Awaited<ReturnType<typeof ordersContext>> & { self: Set<string> }>();
      let resolved = 0;
      for (const row of pending as Any[]) {
        let ctx = contexts.get(row.user_id);
        if (!ctx) {
          const base = await ordersContext(row.user_id);
          ctx = { ...base, self: await selfUserNos(base.ownAdvNos) };
          contexts.set(row.user_id, ctx);
        }
        const query = String(row.pending_query ?? row.nick);
        const { exact, candidates } = await lookupDirectory(query, ctx.adsByCounterparty.get(query) ?? [], ctx.self);
        const hit = exact ?? (!query.trim().endsWith("*") && candidates.length === 1 ? candidates[0] : null);
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

    /**
     * The per-day register: the order total at the start of the day (the previous day's last reading, or the
     * first reading when the merchant has only just been followed) and at the latest reading.
     * Days are Qatar days.
     */
    const recordDaily = async (snap: ReturnType<typeof toSnapshot>) => {
      if (snap.total_orders === null) return;
      const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
      const { data: existing } = await supabase.from("p2p_merchant_daily").select("*").eq("user_no", snap.user_no).eq("day", day).maybeSingle();
      if (existing) {
        await supabase.from("p2p_merchant_daily").update({
          last_total: snap.total_orders, last_sell: snap.sell_orders,
          readings: (existing.readings ?? 0) + 1, online_readings: (existing.online_readings ?? 0) + (snap.online ? 1 : 0),
          updated_at: new Date().toISOString(),
        }).eq("user_no", snap.user_no).eq("day", day);
        return;
      }
      const { data: prev } = await supabase.from("p2p_merchant_daily").select("last_total, last_sell")
        .eq("user_no", snap.user_no).lt("day", day).order("day", { ascending: false }).limit(1).maybeSingle();
      await supabase.from("p2p_merchant_daily").insert({
        user_no: snap.user_no, day,
        baseline_total: prev?.last_total ?? snap.total_orders, last_total: snap.total_orders,
        baseline_sell: prev?.last_sell ?? snap.sell_orders, last_sell: snap.sell_orders,
        readings: 1, online_readings: snap.online ? 1 : 0,
      });
    };

    const pollMany = async (userNos: string[], throttleMs: number) => {
      const polled: string[] = [];
      const failed: string[] = [];
      await Promise.all(userNos.map(async (userNo) => {
        if (Date.now() - (await latestTs(userNo)) < throttleMs) return;
        const profile = await fetchProfile(userNo).catch(() => null);
        if (!profile) { failed.push(userNo); return; }
        const snap = toSnapshot(userNo, profile);
        const { error } = await supabase.from("p2p_merchant_snapshots").insert(snap);
        if (error) { failed.push(userNo); return; }
        await recordDaily(snap).catch((err) => console.warn("recordDaily failed", err));
        polled.push(userNo);
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
      const ctx = await ordersContext(userId);
      const selfFromDirectory = await selfUserNos(ctx.ownAdvNos);
      if (linkedId) {
        if (selfFromDirectory.has(linkedId)) {
          return json({ error: "That link is your own Binance profile. Open the merchant's profile and copy their link." }, 400);
        }
        const profile = await fetchProfile(linkedId);
        if (!profile) return json({ error: "No Binance merchant with that id" }, 404);
        return json({ userNo: linkedId, nick: String(profile.nickName ?? linkedId) });
      }
      if (/^https?:\/\//i.test(pastedLink)) {
        return json({ error: "I could not find a merchant id in that link. Open the merchant's profile in Binance, tap Share, and copy the profile link." }, 404);
      }

      const masked = query.endsWith("*");
      // Ad numbers come from the user's own trades as taker, never from the client and never from the user's own ads.
      const advNos = ctx.adsByCounterparty.get(query) ?? [];
      const known = await lookupDirectory(query, advNos, selfFromDirectory);
      if (known.exact) return json({ userNo: known.exact.userNo, nick: known.exact.nick });

      const adSet = new Set(advNos);
      const entries = await scanAds(fiatList(body.fiats), adSet.size > 0 ? (e) => adSet.has(e.advNo) : undefined);
      await learn(entries);
      const self = await selfUserNos(ctx.ownAdvNos, entries);
      const usable = entries.filter((e) => !self.has(e.userNo));
      const live = matchMerchant(usable, query, advNos);
      if (live.exact) return json({ userNo: live.exact.userNo, nick: live.exact.nick });

      const merged = new Map<string, Candidate>();
      for (const c of [...known.candidates, ...live.candidates]) if (!self.has(c.userNo)) merged.set(c.userNo, c);
      const candidates = [...merged.values()].sort((a, b) => (b.monthOrders ?? 0) - (a.monthOrders ?? 0));
      // A full nickname with one match is that merchant. A masked name only narrows it down, so the user confirms.
      if (!masked && candidates.length === 1) return json({ userNo: candidates[0].userNo, nick: candidates[0].nick });
      if (candidates.length > 0) return json({ candidates: candidates.slice(0, 12) });
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
