import { applyMyShare, computeFIFO, type TrackerState } from '@/lib/tracker-helpers';

export interface SupplierProfit {
  /** Sales revenue of the USDT that came out of this supplier's batches. */
  revenueQAR: number;
  /** FIFO cost of that USDT, i.e. what the supplier was paid for the part that has been sold. */
  costQAR: number;
  /** Share of order fees on that USDT. */
  feeQAR: number;
  /** Cut that went to a partner merchant on linked orders, which is not the merchant's own profit. */
  partnerShareQAR: number;
  /** Revenue minus cost, fees and partner share: the same "net profit" the dashboard reports. */
  netProfitQAR: number;
  /** USDT from this supplier that has been sold. */
  soldUSDT: number;
  /** Orders that drew on this supplier's stock. */
  tradeCount: number;
}

export interface SupplierProfitReport {
  bySupplier: Map<string, SupplierProfit>;
  /**
   * Net profit of fully costed orders that no supplier batch accounts for — stock that
   * came from a borrowed-USDT layer — so the per-supplier figures plus this one add up
   * to the tracker's total net profit from stock sales.
   */
  unattributedNetQAR: number;
}

export const supplierKey = (source: string) => source.trim().toLowerCase();

/**
 * Net profit earned from each supplier's stock, keyed by lower-cased supplier name.
 *
 * Every order is costed by FIFO against specific batches, and each batch belongs to a
 * supplier. An order's revenue, cost and fee are split across the suppliers whose batches
 * it consumed, in proportion to the USDT drawn from each. Profit follows the tracker's own
 * rules (see kpiFor): voided, cancelled, rejected and not-fully-covered orders carry none,
 * and on orders linked to a partner merchant only the merchant's own share counts.
 */
export function supplierProfitReport(
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'>,
): SupplierProfitReport {
  const derived = computeFIFO(state.batches, state.trades, state.usdtTransfers);
  const supplierOfBatch = new Map<string, string>();
  for (const b of state.batches) {
    const key = supplierKey(b.source || '');
    if (key) supplierOfBatch.set(b.id, key);
  }

  const bySupplier = new Map<string, SupplierProfit>();
  let unattributedNetQAR = 0;
  for (const t of state.trades) {
    const calc = derived.tradeCalc.get(t.id);
    if (!calc || !t.usesStock || !calc.ok || calc.shortfallQty > 0 || !(t.amountUSDT > 0)) continue;
    const revenue = t.amountUSDT * t.sellPriceQAR;
    const fullNet = calc.netQAR;
    const myNet = applyMyShare(t, fullNet);
    const touched = new Set<string>();
    let attributedShare = 0;
    for (const slice of calc.slices) {
      const key = supplierOfBatch.get(slice.batchId);
      if (!key) continue;
      const share = slice.qty / t.amountUSDT;
      attributedShare += share;
      const row = bySupplier.get(key) ?? { revenueQAR: 0, costQAR: 0, feeQAR: 0, partnerShareQAR: 0, netProfitQAR: 0, soldUSDT: 0, tradeCount: 0 };
      row.revenueQAR += revenue * share;
      row.costQAR += slice.cost;
      row.feeQAR += (Number(t.feeQAR) || 0) * share;
      row.partnerShareQAR += (fullNet - myNet) * share;
      row.soldUSDT += slice.qty;
      if (!touched.has(key)) { row.tradeCount += 1; touched.add(key); }
      bySupplier.set(key, row);
    }
    // Slices that no supplier batch accounts for: the unattributed remainder of this order's profit.
    const unattributed = 1 - attributedShare;
    if (unattributed > 1e-9) {
      // Profit isn't linear in the slices (each slice has its own cost), so cost the missing part directly.
      const attributedCost = calc.slices.reduce((s, sl) => s + (supplierOfBatch.has(sl.batchId) ? sl.cost : 0), 0);
      const missingCost = calc.totalCost - attributedCost;
      const missingNet = revenue * unattributed - missingCost - (Number(t.feeQAR) || 0) * unattributed;
      unattributedNetQAR += applyMyShare(t, missingNet);
    }
  }
  for (const row of bySupplier.values()) row.netProfitQAR = row.revenueQAR - row.costQAR - row.feeQAR - row.partnerShareQAR;
  return { bySupplier, unattributedNetQAR };
}

export function supplierProfitByName(
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'>,
): Map<string, SupplierProfit> {
  return supplierProfitReport(state).bySupplier;
}
