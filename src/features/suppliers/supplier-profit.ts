import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';

export interface SupplierProfit {
  /** Sales revenue of the USDT that came out of this supplier's batches. */
  revenueQAR: number;
  /** FIFO cost of that USDT, i.e. what the supplier was paid for the part that has been sold. */
  costQAR: number;
  /** Share of order fees on that USDT. */
  feeQAR: number;
  /** Revenue minus cost minus fees. */
  netProfitQAR: number;
  /** USDT from this supplier that has been sold. */
  soldUSDT: number;
  /** Orders that drew on this supplier's stock. */
  tradeCount: number;
}

export const supplierKey = (source: string) => source.trim().toLowerCase();

/**
 * Net profit earned from each supplier's stock, keyed by lower-cased supplier name.
 *
 * Every order is costed by FIFO against specific batches. Each batch belongs to a
 * supplier, so an order's revenue, cost and fee are split across the suppliers whose
 * batches it consumed, in proportion to the USDT drawn from each. Orders that are
 * voided, cancelled, rejected or not fully covered by stock carry no profit in the
 * tracker, so they carry none here either.
 */
export function supplierProfitByName(
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'>,
): Map<string, SupplierProfit> {
  const derived = computeFIFO(state.batches, state.trades, state.usdtTransfers);
  const supplierOfBatch = new Map<string, string>();
  for (const b of state.batches) {
    const key = supplierKey(b.source || '');
    if (key) supplierOfBatch.set(b.id, key);
  }

  const out = new Map<string, SupplierProfit>();
  for (const t of state.trades) {
    const calc = derived.tradeCalc.get(t.id);
    if (!calc || !t.usesStock || !calc.ok || calc.shortfallQty > 0 || !(t.amountUSDT > 0)) continue;
    const revenue = t.amountUSDT * t.sellPriceQAR;
    const touched = new Set<string>();
    for (const slice of calc.slices) {
      const key = supplierOfBatch.get(slice.batchId);
      if (!key) continue;
      const share = slice.qty / t.amountUSDT;
      const row = out.get(key) ?? { revenueQAR: 0, costQAR: 0, feeQAR: 0, netProfitQAR: 0, soldUSDT: 0, tradeCount: 0 };
      row.revenueQAR += revenue * share;
      row.costQAR += slice.cost;
      row.feeQAR += (Number(t.feeQAR) || 0) * share;
      row.soldUSDT += slice.qty;
      if (!touched.has(key)) { row.tradeCount += 1; touched.add(key); }
      out.set(key, row);
    }
  }
  for (const row of out.values()) row.netProfitQAR = row.revenueQAR - row.costQAR - row.feeQAR;
  return out;
}
