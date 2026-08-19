import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
// (touch: trigger CI redeploy)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Exchange = "binance" | "okx";
type SyncAction = "balances" | "p2p-orders" | "transfers" | "all";

/** USDT moving in/out by means other than a P2P order (Pay / on-chain). */
interface TransferRow {
  kind: "pay" | "network";
  direction: "in" | "out";
  asset: string;
  amount: number;
  status: string;
  reference: string;
  counterparty: string | null;
  network: string | null;
  transfer_time: string | null;
  raw: unknown;
}

const TRACKED_ASSET = "USDT";

interface Credentials {
  api_key: string;
  api_secret: string;
  passphrase: string | null;
}

// ── Signing helpers ──────────────────────────────────────────────────────

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── Binance ───────────────────────────────────────────────────────────────

const BINANCE_BASE = "https://api.binance.com";

async function binanceSignedRequest(
  creds: Credentials,
  path: string,
  params: Record<string, string | number> = {},
  method = "GET",
) {
  const query = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "10000" });
  const signature = await hmacSha256Hex(creds.api_secret, query.toString());
  query.set("signature", signature);

  const res = await fetch(`${BINANCE_BASE}${path}?${query.toString()}`, {
    method,
    headers: { "X-MBX-APIKEY": creds.api_key },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Binance ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function fetchBinanceBalances(creds: Credentials) {
  const results: { account_type: "spot" | "funding"; asset: string; free: number; locked: number }[] = [];

  const spot = await binanceSignedRequest(creds, "/api/v3/account");
  for (const b of spot.balances ?? []) {
    if (b.asset !== "USDT") continue;
    const free = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    if (free > 0 || locked > 0) {
      results.push({ account_type: "spot", asset: b.asset, free, locked });
    }
  }

  const funding = await binanceSignedRequest(creds, "/sapi/v1/asset/get-funding-asset", {}, "POST");
  for (const b of Array.isArray(funding) ? funding : []) {
    const free = parseFloat(b.free ?? "0");
    const locked = parseFloat(b.locked ?? "0") + parseFloat(b.freeze ?? "0");
    if (free > 0 || locked > 0) {
      results.push({ account_type: "funding", asset: b.asset, free, locked });
    }
  }

  return results;
}

async function fetchBinanceP2POrders(creds: Credentials) {
  const orders: {
    order_number: string;
    side: "buy" | "sell";
    asset: string;
    fiat: string;
    amount: number;
    price: number;
    total: number;
    status: string;
    counterparty: string | null;
    order_time: string | null;
    raw: unknown;
  }[] = [];

  for (const tradeType of ["BUY", "SELL"] as const) {
    const json = await binanceSignedRequest(creds, "/sapi/v1/c2c/orderMatch/listUserOrderHistory", {
      tradeType,
      rows: 100,
    });
    for (const o of json.data ?? []) {
      const grossAmount = parseFloat(o.amount ?? "0");
      const total = parseFloat(o.totalPrice ?? o.total ?? "0");
      const commission = parseFloat(o.commission ?? "0");
      // Binance deducts the P2P fee from the crypto side of a BUY: what actually
      // lands in the wallet is amount - commission, not the gross traded amount.
      // Recompute the unit price against the net amount so total (fiat paid)
      // still reconciles, keeping the imported batch's cost basis accurate.
      const netAmount = tradeType === "BUY" ? grossAmount - commission : grossAmount;
      const unitPrice = netAmount > 0 ? total / netAmount : parseFloat(o.unitPrice ?? o.price ?? "0");
      orders.push({
        order_number: String(o.orderNumber),
        side: tradeType === "BUY" ? "buy" : "sell",
        asset: o.asset,
        fiat: o.fiat,
        amount: netAmount,
        price: unitPrice,
        total,
        status: String(o.orderStatus ?? o.status ?? "UNKNOWN"),
        counterparty: o.counterPartNickName ?? null,
        order_time: o.createTime ? new Date(Number(o.createTime)).toISOString() : null,
        raw: o,
      });
    }
  }
  return orders;
}

/**
 * Binance Pay transactions plus on-chain deposits/withdrawals.
 * Each source is tried independently so one unavailable permission scope
 * doesn't wipe out the others.
 */
async function fetchBinanceTransfers(creds: Credentials): Promise<{ rows: TransferRow[]; failures: string[] }> {
  const rows: TransferRow[] = [];
  const failures: string[] = [];

  try {
    const pay = await binanceSignedRequest(creds, "/sapi/v1/pay/transactions", { limit: 100 });
    for (const p of pay.data ?? []) {
      if (p.currency !== TRACKED_ASSET) continue;
      const amount = parseFloat(p.amount ?? "0");
      rows.push({
        kind: "pay",
        // Binance reports the signed amount: negative means funds left the account.
        direction: amount < 0 ? "out" : "in",
        asset: p.currency,
        amount: Math.abs(amount),
        status: String(p.orderStatus ?? "SUCCESS"),
        reference: String(p.transactionId ?? p.orderId),
        counterparty: p.payerInfo?.name ?? p.receiverInfo?.name ?? null,
        network: null,
        transfer_time: p.transactionTime ? new Date(Number(p.transactionTime)).toISOString() : null,
        raw: p,
      });
    }
  } catch (err) {
    failures.push(`pay: ${err instanceof Error ? err.message : String(err)}`);
  }

  const onChain: { path: string; direction: "in" | "out"; timeKey: string }[] = [
    { path: "/sapi/v1/capital/deposit/hisrec", direction: "in", timeKey: "insertTime" },
    { path: "/sapi/v1/capital/withdraw/history", direction: "out", timeKey: "applyTime" },
  ];
  for (const src of onChain) {
    try {
      const list = await binanceSignedRequest(creds, src.path, { limit: 100 });
      for (const d of Array.isArray(list) ? list : []) {
        if (d.coin !== TRACKED_ASSET) continue;
        const raw = d[src.timeKey];
        const ms = typeof raw === "number" ? raw : Date.parse(raw ?? "");
        rows.push({
          kind: "network",
          direction: src.direction,
          asset: d.coin,
          amount: parseFloat(d.amount ?? "0"),
          status: String(d.status ?? ""),
          reference: String(d.txId ?? d.id),
          counterparty: d.address ?? null,
          network: d.network ?? null,
          transfer_time: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
          raw: d,
        });
      }
    } catch (err) {
      failures.push(`${src.direction === "in" ? "deposits" : "withdrawals"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { rows, failures };
}

// ── OKX ───────────────────────────────────────────────────────────────────

const OKX_BASE = "https://www.okx.com";

async function okxSignedRequest(creds: Credentials, path: string, method = "GET") {
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method}${path}`;
  const signature = await hmacSha256Base64(creds.api_secret, prehash);

  const res = await fetch(`${OKX_BASE}${path}`, {
    method,
    headers: {
      "OK-ACCESS-KEY": creds.api_key,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": creds.passphrase ?? "",
      "Content-Type": "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== "0") {
    throw new Error(`OKX ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function fetchOkxBalances(creds: Credentials) {
  const results: { account_type: "spot" | "funding"; asset: string; free: number; locked: number }[] = [];

  const trading = await okxSignedRequest(creds, "/api/v5/account/balance");
  for (const acc of trading.data ?? []) {
    for (const d of acc.details ?? []) {
      if (d.ccy !== "USDT") continue;
      const free = parseFloat(d.availBal ?? "0");
      const locked = parseFloat(d.frozenBal ?? "0");
      if (free > 0 || locked > 0) {
        results.push({ account_type: "spot", asset: d.ccy, free, locked });
      }
    }
  }

  const funding = await okxSignedRequest(creds, "/api/v5/asset/balances");
  for (const d of funding.data ?? []) {
    const free = parseFloat(d.availBal ?? "0");
    const locked = parseFloat(d.frozenBal ?? "0");
    if (free > 0 || locked > 0) {
      results.push({ account_type: "funding", asset: d.ccy, free, locked });
    }
  }

  return results;
}

/**
 * OKX deposits/withdrawals. OKX flags internal account-to-account moves
 * (its "Pay"-equivalent) via the deposit type field, so one endpoint pair
 * covers both kinds.
 */
async function fetchOkxTransfers(creds: Credentials): Promise<{ rows: TransferRow[]; failures: string[] }> {
  const rows: TransferRow[] = [];
  const failures: string[] = [];

  const sources: { path: string; direction: "in" | "out" }[] = [
    { path: "/api/v5/asset/deposit-history?limit=100", direction: "in" },
    { path: "/api/v5/asset/withdrawal-history?limit=100", direction: "out" },
  ];

  for (const src of sources) {
    try {
      const json = await okxSignedRequest(creds, src.path);
      for (const d of json.data ?? []) {
        if (d.ccy !== TRACKED_ASSET) continue;
        // OKX: type "3"/"4" denote internal (account-to-account) transfers.
        const internal = d.type === "3" || d.type === "4";
        rows.push({
          kind: internal ? "pay" : "network",
          direction: src.direction,
          asset: d.ccy,
          amount: parseFloat(d.amt ?? "0"),
          status: String(d.state ?? ""),
          reference: String(d.txId ?? d.wdId ?? d.depId ?? ""),
          counterparty: (src.direction === "in" ? d.from : d.to) ?? null,
          network: d.chain ?? null,
          transfer_time: d.ts ? new Date(Number(d.ts)).toISOString() : null,
          raw: d,
        });
      }
    } catch (err) {
      failures.push(`${src.direction === "in" ? "deposits" : "withdrawals"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { rows: rows.filter((r) => r.reference), failures };
}

async function fetchOkxP2POrders(creds: Credentials) {
  const orders: {
    order_number: string;
    side: "buy" | "sell";
    asset: string;
    fiat: string;
    amount: number;
    price: number;
    total: number;
    status: string;
    counterparty: string | null;
    order_time: string | null;
    raw: unknown;
  }[] = [];

  let json;
  try {
    json = await okxSignedRequest(creds, "/api/v5/c2c/order-mgmt/orders-list?limit=100");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(" 404 ")) {
      throw new Error(
        "OKX does not expose personal P2P order history on this API endpoint/account tier. " +
          "Balances still sync normally; P2P order import isn't available for OKX yet.",
      );
    }
    throw err;
  }
  for (const o of json.data ?? []) {
    const side = String(o.side ?? "").toLowerCase() === "sell" ? "sell" : "buy";
    orders.push({
      order_number: String(o.orderId ?? o.id),
      side,
      asset: o.baseCcy ?? o.currency ?? "USDT",
      fiat: o.quoteCcy ?? o.fiatCurrency ?? "",
      amount: parseFloat(o.baseAmt ?? o.amount ?? "0"),
      price: parseFloat(o.price ?? "0"),
      total: parseFloat(o.quoteAmt ?? o.total ?? "0"),
      status: String(o.state ?? o.status ?? "UNKNOWN"),
      counterparty: o.counterpartyName ?? null,
      order_time: o.createTime ? new Date(Number(o.createTime)).toISOString() : null,
      raw: o,
    });
  }
  return orders;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify the calling user from their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const exchange = body.exchange as Exchange;
    const action = (body.action as SyncAction) ?? "all";

    if (exchange !== "binance" && exchange !== "okx") {
      return new Response(JSON.stringify({ error: `Unknown exchange: ${exchange}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for reading credentials and writing results (RLS-safe,
    // scoped manually to userId below).
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: credRow, error: credErr } = await admin
      .from("exchange_credentials")
      .select("api_key, api_secret, passphrase")
      .eq("user_id", userId)
      .eq("exchange", exchange)
      .maybeSingle();

    if (credErr || !credRow) {
      return new Response(JSON.stringify({ error: `No ${exchange} credentials connected` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds: Credentials = {
      api_key: credRow.api_key,
      api_secret: credRow.api_secret,
      passphrase: credRow.passphrase,
    };

    const summary: Record<string, number> = {};
    const errors: Record<string, string> = {};

    if (action === "balances" || action === "all") {
      try {
        const balances = exchange === "binance"
          ? await fetchBinanceBalances(creds)
          : await fetchOkxBalances(creds);

        // Replace this exchange's balance snapshot for the user.
        await admin.from("exchange_balances").delete().eq("user_id", userId).eq("exchange", exchange);
        if (balances.length > 0) {
          const { error } = await admin.from("exchange_balances").insert(
            balances.map((b) => ({
              user_id: userId,
              exchange,
              account_type: b.account_type,
              asset: b.asset,
              free: b.free,
              locked: b.locked,
            })),
          );
          if (error) throw error;
        }
        summary.balances = balances.length;
      } catch (err) {
        errors.balances = err instanceof Error ? err.message : String(err);
      }
    }

    if (action === "p2p-orders" || action === "all") {
      try {
        const orders = exchange === "binance"
          ? await fetchBinanceP2POrders(creds)
          : await fetchOkxP2POrders(creds);

        if (orders.length > 0) {
          const { error } = await admin.from("exchange_p2p_orders").upsert(
            orders.map((o) => ({
              user_id: userId,
              exchange,
              order_number: o.order_number,
              side: o.side,
              asset: o.asset,
              fiat: o.fiat,
              amount: o.amount,
              price: o.price,
              total: o.total,
              status: o.status,
              counterparty: o.counterparty,
              order_time: o.order_time,
              raw: o.raw,
            })),
            { onConflict: "user_id,exchange,order_number", ignoreDuplicates: false },
          );
          if (error) throw error;
        }
        summary.p2pOrders = orders.length;
      } catch (err) {
        errors.p2pOrders = err instanceof Error ? err.message : String(err);
      }
    }

    if (action === "transfers" || action === "all") {
      try {
        const { rows: transfers, failures } = exchange === "binance"
          ? await fetchBinanceTransfers(creds)
          : await fetchOkxTransfers(creds);

        if (transfers.length > 0) {
          const { error } = await admin.from("exchange_transfers").upsert(
            transfers.map((tr) => ({
              user_id: userId,
              exchange,
              kind: tr.kind,
              direction: tr.direction,
              asset: tr.asset,
              amount: tr.amount,
              status: tr.status,
              reference: tr.reference,
              counterparty: tr.counterparty,
              network: tr.network,
              transfer_time: tr.transfer_time,
              raw: tr.raw,
            })),
            { onConflict: "user_id,exchange,kind,direction,reference", ignoreDuplicates: false },
          );
          if (error) throw error;
        }
        summary.transfers = transfers.length;
        if (failures.length > 0) {
          errors.transfers = failures.join("; ");
        }
      } catch (err) {
        errors.transfers = err instanceof Error ? err.message : String(err);
      }
    }

    const combinedError = Object.entries(errors)
      .map(([section, msg]) => `${section}: ${msg}`)
      .join(" | ") || null;

    await admin
      .from("exchange_credentials")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: combinedError })
      .eq("user_id", userId)
      .eq("exchange", exchange);

    // Only fail the whole request if every requested section failed outright
    // (a section that returned partial data alongside a warning still counts as succeeded).
    const requestedSections = action === "all" ? 3 : 1;
    const hardFailures = Object.keys(errors).filter((section) => !(section in summary));
    if (hardFailures.length >= requestedSections) {
      return new Response(JSON.stringify({ error: combinedError }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, ...summary, errors: Object.keys(errors).length ? errors : undefined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
