import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildBuyerStatements } from "../../../src/features/stock/utils/loanStatement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type AnyTrade = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "Missing token" }, 400);
    // Default redacted: the public /statements/:token page never receives the
    // USDT quantity or the QAR conversion rate. Cash Management's own inline
    // preview opts in with ?internal=1 to keep showing the full breakdown.
    const clientSafe = url.searchParams.get("internal") !== "1";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Service-role client — the only piece of this function allowed to bypass
    // RLS. It never accepts or forwards any client-supplied credentials.
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: link, error: linkError } = await supabase
      .from("buyer_statement_links")
      .select("user_id, customer_id, currency")
      .eq("token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (linkError) throw linkError;
    if (!link) return json({ error: "Not found" }, 404);

    const { data: snapshot, error: snapshotError } = await supabase
      .from("tracker_snapshots")
      .select("state")
      .eq("user_id", link.user_id)
      .maybeSingle();

    if (snapshotError) throw snapshotError;
    if (!snapshot?.state) return json({ error: "Not found" }, 404);

    const state = snapshot.state as { customers?: unknown; customerLoans?: unknown; trades?: AnyTrade[] };
    const statements = buildBuyerStatements({
      // deno-lint-ignore no-explicit-any
      loans: (state.customerLoans ?? []) as any,
      // deno-lint-ignore no-explicit-any
      customers: (state.customers ?? []) as any,
      now: Date.now(),
    });

    // A buyer can carry loans in more than one currency (separate statements) —
    // the link is scoped to one, so match both fields, not customerId alone.
    const statement = statements.find((s) => s.customerId === link.customer_id && s.currency === link.currency);
    if (!statement) return json({ error: "Not found" }, 404);

    // Binance/OKX P2P sell orders for this buyer's trades. Trades imported
    // after the originalFiat* fields were added carry their own snapshot of
    // the exchange order (captured once, at import time, so the statement
    // doesn't silently change if exchange_p2p_orders gets re-synced later);
    // older trades fall back to a join against exchange_p2p_orders below.
    const buyerTrades = (state.trades ?? []).filter((tr) => tr && tr.customerId === link.customer_id);

    type BinanceOrderRow = {
      orderNumber: string;
      date: string | number | null;
      counterparty: string | null;
      exchange: string;
      fiat: string;
      fiatAmount: number;
      fiatPrice: number;
      usdtAmount: number;
      qarRate: number;
      qarAmount: number;
    };

    const binanceOrders: BinanceOrderRow[] = [];
    const tradesNeedingFallback: AnyTrade[] = [];

    for (const trade of buyerTrades) {
      if (trade.originalFiat && trade.originalFiatAmount != null) {
        const usdtAmount = Number(trade.amountUSDT) || 0;
        const qarRate = Number(trade.sellPriceQAR) || 0;
        binanceOrders.push({
          orderNumber: trade.exchangeOrderNumber ?? "",
          date: trade.ts ?? null,
          counterparty: trade.exchangeCounterparty ?? null,
          exchange: trade.importedFrom ?? "",
          fiat: trade.originalFiat,
          fiatAmount: Math.round(Number(trade.originalFiatAmount) || 0),
          fiatPrice: Number(trade.originalFiatPriceUSDT) || 0,
          usdtAmount,
          qarRate,
          qarAmount: Math.round(usdtAmount * qarRate),
        });
      } else if (trade.importedFrom) {
        tradesNeedingFallback.push(trade);
      }
    }

    if (tradesNeedingFallback.length > 0) {
      const tradeById = new Map(tradesNeedingFallback.map((tr) => [tr.id, tr]));
      const { data: exchangeOrders } = await supabase
        .from("exchange_p2p_orders")
        .select("exchange, order_number, price, total, fiat, counterparty, order_time, linked_entity_type, linked_entity_id")
        .eq("user_id", link.user_id)
        .eq("linked_entity_type", "trade");

      for (const o of exchangeOrders ?? []) {
        const trade = tradeById.get(o.linked_entity_id);
        if (!trade) continue;
        const usdtAmount = Number(trade.amountUSDT) || 0;
        const qarRate = Number(trade.sellPriceQAR) || 0;
        binanceOrders.push({
          orderNumber: o.order_number,
          date: o.order_time ?? trade.ts ?? null,
          counterparty: o.counterparty,
          exchange: o.exchange,
          fiat: o.fiat,
          // exchange_p2p_orders.amount is the crypto (USDT) leg, not fiat —
          // .total is the actual EGP Binance reported for this order.
          fiatAmount: Math.round(Number(o.total) || 0),
          fiatPrice: Number(o.price) || 0,
          usdtAmount,
          qarRate,
          qarAmount: Math.round(usdtAmount * qarRate),
        });
      }
    }

    binanceOrders.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());

    const response = {
      customerName: statement.customerName,
      currency: statement.currency,
      totalLoaned: Math.round(statement.totalLoaned),
      totalRepaid: Math.round(statement.totalRepaid),
      outstanding: Math.round(statement.outstanding),
      issueDate: new Date().toISOString().slice(0, 10),
      orders: statement.loans.map((row) => ({
        ref: row.ref,
        date: row.loan.ts,
        amount: Math.round(row.principal),
        paid: Math.round(row.repaid),
        remaining: Math.round(row.remaining),
        settled: row.settled,
        note: row.loan.note || null,
      })),
      payments: statement.entries
        .filter((e) => e.kind === "payment")
        .map((e) => ({
          date: e.ts,
          amount: Math.round(e.credit),
          note: e.description || null,
          ref: e.ref || null,
        })),
      // usdtAmount and qarRate are the two figures the buyer must never see —
      // stripped here, server-side, rather than only hidden in the UI, so
      // they never reach the public page's network response at all.
      binanceOrders: binanceOrders.map((o) => (
        clientSafe ? { ...o, usdtAmount: undefined, qarRate: undefined } : o
      )),
    };

    return json(response);
  } catch (err) {
    console.error("public-buyer-statement error:", err);
    return json({ error: "Server error" }, 500);
  }
});
