export type SaleEntryMode = 'price_vol' | 'qty_total' | 'qty_price' | 'qty_markup';
export type SaleMode = 'USDT' | 'QAR' | 'EGP';

export interface SaleDraft {
  quantityUsdt: number;
  sellPriceQar: number;
  revenueQar: number;
  feeQar: number;
}

export interface StockCoverage {
  availableFifoUsdt: number;
  saleQty: number;
  stockShortfall: number;
}

interface DeriveSaleDraftInput {
  saleEntryMode: SaleEntryMode;
  saleMode: SaleMode;
  saleUsdtQty: string;
  saleAmount: string;
  saleSell: string;
  saleFee: string;
}

export function deriveSaleDraft(input: DeriveSaleDraftInput): SaleDraft {
  const { saleEntryMode, saleMode, saleUsdtQty, saleAmount, saleSell, saleFee } = input;

  let quantityUsdt = 0;
  let sellPriceQar = 0;

  if (saleEntryMode === 'qty_total') {
    quantityUsdt = Number(saleUsdtQty);
    const revenueQar = Number(saleAmount);
    sellPriceQar = quantityUsdt > 0 ? revenueQar / quantityUsdt : 0;
  } else if (saleEntryMode === 'qty_price' || saleEntryMode === 'qty_markup') {
    // Markup mode writes its computed price into saleSell (see markupSellPrice).
    quantityUsdt = Number(saleUsdtQty);
    sellPriceQar = Number(saleSell);
  } else {
    const rawAmount = Number(saleAmount);
    sellPriceQar = Number(saleSell);
    quantityUsdt = saleMode === 'USDT' ? rawAmount : sellPriceQar > 0 ? rawAmount / sellPriceQar : 0;
  }

  const feeQar = Number(saleFee) || 0;
  const revenueQar = quantityUsdt * sellPriceQar;
  return { quantityUsdt, sellPriceQar, revenueQar, feeQar };
}

export function computeStockCoverage(availableFifoUsdt: number, saleQty: number): StockCoverage {
  const safeAvailable = Number.isFinite(availableFifoUsdt) ? Math.max(0, availableFifoUsdt) : 0;
  const safeSaleQty = Number.isFinite(saleQty) ? Math.max(0, saleQty) : 0;
  return {
    availableFifoUsdt: safeAvailable,
    saleQty: safeSaleQty,
    stockShortfall: Math.max(0, safeSaleQty - safeAvailable),
  };
}

export function canSubmitWithStockCoverage(
  coverage: StockCoverage,
  usesStock: boolean,
  overrideEnabled: boolean,
  overrideConfirmed: boolean,
): boolean {
  if (!usesStock) return true;
  if (coverage.stockShortfall <= 0) return true;
  return overrideEnabled && overrideConfirmed;
}

/**
 * Sell price that nets exactly `markupPct` % over the real cost of the USDT
 * being sold: price = (cost × (1 + markup%) + fee) ÷ quantity. The fee is
 * folded in so the % is what is actually earned, not eaten by the fee.
 * Rounded UP to `decimals` places so rounding never drops the profit below
 * the target. Returns 0 when there is nothing to price yet.
 */
export function markupSellPrice(input: {
  /** FIFO (or manual) cost of the whole quantity, in the sale's fiat. */
  totalCost: number;
  quantityUsdt: number;
  markupPct: number;
  feeQar?: number;
  decimals?: number;
}): number {
  const { totalCost, quantityUsdt, markupPct, feeQar = 0, decimals = 3 } = input;
  if (!(quantityUsdt > 0) || !(totalCost > 0) || !Number.isFinite(markupPct)) return 0;
  const exact = (totalCost * (1 + markupPct / 100) + (Number(feeQar) || 0)) / quantityUsdt;
  if (!(exact > 0)) return 0;
  const factor = Math.pow(10, decimals);
  // Strip float noise (e.g. 3.8700000000000001) before rounding up.
  return Math.ceil(Math.round(exact * factor * 1e6) / 1e6) / factor;
}
