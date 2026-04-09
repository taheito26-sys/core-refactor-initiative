export type SaleEntryMode = 'price_vol' | 'qty_total' | 'qty_price';
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
  } else if (saleEntryMode === 'qty_price') {
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
