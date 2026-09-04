import { buildBuyerStatements } from "../../../src/features/stock/utils/loanStatement.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;
// deno-lint-ignore no-explicit-any
type AnyTrade = any;

export interface StatementLinkRow {
  user_id: string;
  customer_id: string;
  currency: string;
}

/**
 * Builds the sanitized statement payload for one buyer_statement_links row.
 * Shared by the public token page and the authenticated customer-portal
 * page so both stay byte-for-byte identical in what they redact.
 */
export async function buildLoanStatementResponse(
  supabase: AnySupabaseClient,
  link: StatementLinkRow,
  clientSafe: boolean,
) {
  const { data: snapshot, error: snapshotError } = await supabase
    .from("tracker_snapshots")
    .select("state")
    .eq("user_id", link.user_id)
    .maybeSingle();

  if (snapshotError) throw snapshotError;
  if (!snapshot?.state) return null;

  const state = snapshot.state as { customers?: unknown; customerLoans?: unknown; trades?: AnyTrade[] };
  const statements = buildBuyerStatements({
    // deno-lint-ignore no-explicit-any
    loans: (state.customerLoans ?? []) as any,
    // deno-lint-ignore no-explicit-any
    customers: (state.customers ?? []) as any,
    now: Date.now(),
  });

  const statement = statements.find((s) => s.customerId === link.customer_id && s.currency === link.currency);
  if (!statement) return null;

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
        fiatAmount: Math.round(Number(o.total) || 0),
        fiatPrice: Number(o.price) || 0,
        usdtAmount,
        qarRate,
        qarAmount: Math.round(usdtAmount * qarRate),
      });
    }
  }

  binanceOrders.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());

  return {
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
    // usdtAmount and qarRate are the two figures a buyer must never see —
    // stripped here, server-side, rather than only hidden in the UI, so
    // they never reach a buyer-facing network response at all.
    binanceOrders: binanceOrders.map((o) => (
      clientSafe ? { ...o, usdtAmount: undefined, qarRate: undefined } : o
    )),
  };
}
