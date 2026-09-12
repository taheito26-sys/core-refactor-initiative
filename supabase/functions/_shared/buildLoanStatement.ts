import { buildBuyerStatements, groupPayments } from "../../../src/features/stock/utils/loanStatement.ts";

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
    tradeId: string;
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
        tradeId: trade.id,
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
        tradeId: trade.id,
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
      tradeId: row.loan.tradeId ?? null,
      date: row.loan.ts,
      amount: Math.round(row.principal),
      paid: Math.round(row.repaid),
      remaining: Math.round(row.remaining),
      settled: row.settled,
      note: row.loan.note || null,
    })),
    // One physical payment applied across several loans/orders (shared
    // batchId) is grouped into a single row here — a buyer sees "you paid
    // X on this date", never which specific orders it was split across.
    payments: groupPayments(statement.entries.filter((e) => e.kind === "payment")).map((g) => ({
      date: g.ts,
      amount: Math.round(g.credit),
      note: g.description || null,
      // Order references identify which specific orders a payment settled —
      // that breakdown is for the merchant's own internal view only.
      ref: clientSafe ? null : g.refs.join(", "),
    })),
    // usdtAmount and qarRate are the two figures a buyer must never see —
    // stripped here, server-side, rather than only hidden in the UI, so
    // they never reach a buyer-facing network response at all.
    binanceOrders: binanceOrders.map((o) => (
      clientSafe ? { ...o, usdtAmount: undefined, qarRate: undefined } : o
    )),
  };
}

export interface MonthlyBinanceRow {
  orderNumber: string;
  date: string | number | null;
  counterparty: string | null;
  fiat: string;
  fiatAmount: number;
  fiatPrice: number;
}

export interface MonthlyStatementResponse {
  customerName: string;
  currency: string;
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  /**
   * Whatever was still unpaid from before this month started — every order
   * placed and payment received prior to the 1st of this month, netted
   * out. A buyer who owed money going into the month must see that debt
   * carried forward, not just this month's own new orders.
   */
  previousBalance: number;
  issueDate: string;
  month: string;
  payments: Array<{ date: number; amount: number; note: string | null; ref: string | null }>;
  /**
   * Every EGP sell transaction the merchant made in the selected month, across
   * ALL of their buyers — not scoped to this one customer. This mirrors the
   * merchant's own monthly "sold against EGP" ledger, included on the buyer's
   * statement as the FX-sourcing record behind that month's settlement.
   * Deliberately never carries usdtAmount or a QAR conversion rate — a buyer
   * only ever sees the EGP amount and the EGP/USDT price, same as every other
   * buyer-facing statement in this app.
   */
  binanceOrders: MonthlyBinanceRow[];
}

/**
 * One buyer's statement, re-scoped to a calendar month: the same cumulative
 * totals and full payment history as {@link buildLoanStatementResponse} (the
 * "up to issue date" figures a buyer expects to always see), plus the
 * merchant's month-scoped, buyer-wide EGP sell ledger as a second section —
 * the trail of trades that funded that month's settlements.
 */
export async function buildMonthlyStatementResponse(
  // deno-lint-ignore no-explicit-any
  supabase: AnySupabaseClient,
  link: StatementLinkRow,
  month: string,
): Promise<MonthlyStatementResponse | null> {
  const base = await buildLoanStatementResponse(supabase, link, false);
  if (!base) return null;

  const { data: snapshot, error: snapshotError } = await supabase
    .from("tracker_snapshots")
    .select("state")
    .eq("user_id", link.user_id)
    .maybeSingle();
  if (snapshotError) throw snapshotError;

  const state = (snapshot?.state ?? {}) as { trades?: AnyTrade[] };
  const allTrades = state.trades ?? [];

  const [y, m] = month.split("-").map((n: string) => parseInt(n, 10));
  const monthStart = new Date(y, m - 1, 1).getTime();
  const monthEnd = new Date(y, m, 1).getTime();
  const inMonth = (ts: number) => ts >= monthStart && ts < monthEnd;

  const rows: MonthlyBinanceRow[] = [];
  const tradesNeedingFallback: AnyTrade[] = [];

  for (const trade of allTrades) {
    if (trade.voided) continue;
    if (trade.originalFiat === "EGP" && trade.originalFiatAmount != null) {
      if (!inMonth(Number(trade.ts) || 0)) continue;
      rows.push({
        orderNumber: trade.exchangeOrderNumber ?? "",
        date: trade.ts ?? null,
        counterparty: trade.exchangeCounterparty ?? null,
        fiat: trade.originalFiat,
        fiatAmount: Math.round(Number(trade.originalFiatAmount) || 0),
        fiatPrice: Number(trade.originalFiatPriceUSDT) || 0,
      });
    } else if (trade.importedFrom && inMonth(Number(trade.ts) || 0)) {
      tradesNeedingFallback.push(trade);
    }
  }

  if (tradesNeedingFallback.length > 0) {
    const tradeById = new Map(tradesNeedingFallback.map((tr) => [tr.id, tr]));
    const { data: exchangeOrders } = await supabase
      .from("exchange_p2p_orders")
      .select("order_number, price, total, fiat, counterparty, order_time, linked_entity_type, linked_entity_id")
      .eq("user_id", link.user_id)
      .eq("linked_entity_type", "trade")
      .eq("fiat", "EGP");

    for (const o of exchangeOrders ?? []) {
      const trade = tradeById.get(o.linked_entity_id);
      if (!trade) continue;
      rows.push({
        orderNumber: o.order_number,
        date: o.order_time ?? trade.ts ?? null,
        counterparty: o.counterparty,
        fiat: o.fiat,
        fiatAmount: Math.round(Number(o.total) || 0),
        fiatPrice: Number(o.price) || 0,
      });
    }
  }

  rows.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());

  // Strictly month-scoped, per the buyer's expectation of "September's
  // statement" — only orders placed and payments received in that calendar
  // month, not the cumulative to-date figures. base.orders/base.payments are
  // both timestamped, so this filters and re-sums rather than reusing the
  // running totals from buildLoanStatementResponse.
  const monthPayments = base.payments.filter((p) => inMonth(Number(p.date) || 0));
  const monthOrders = base.orders.filter((o) => inMonth(Number(o.date) || 0));
  const totalLoaned = Math.round(monthOrders.reduce((sum, o) => sum + o.amount, 0));
  const totalRepaid = Math.round(monthPayments.reduce((sum, p) => sum + p.amount, 0));

  // Derived from the same all-time outstanding balance the tracker itself
  // shows (base.outstanding), not by re-filtering individual orders/payments
  // by date: a loan or payment with a missing/malformed timestamp would
  // silently drop out of both the "this month" and "prior" buckets under a
  // per-row filter, understating (or zeroing) the carried-forward balance
  // without ever throwing an error. Defining it algebraically instead —
  // whatever is left after backing out this month's own net movement —
  // guarantees outstanding always reconciles to base.outstanding exactly,
  // the same number the merchant's tracker displays for this buyer.
  const previousBalance = Math.round(base.outstanding - totalLoaned + totalRepaid);

  return {
    customerName: base.customerName,
    currency: base.currency,
    totalLoaned,
    totalRepaid,
    outstanding: base.outstanding,
    previousBalance,
    issueDate: base.issueDate,
    month,
    payments: monthPayments,
    binanceOrders: rows,
  };
}
