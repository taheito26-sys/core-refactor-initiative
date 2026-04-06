export type SaleEntryMode = 'price_vol' | 'qty_total' | 'qty_price';
export type SaleMode = 'USDT' | 'QAR';

export interface SaleDraft {
  quantityUsdt: number;
  sellPriceQar: number;
  revenueQar: number;
  feeQar: number;
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
