import { describe, expect, it } from 'vitest';
import { deriveSaleDraft } from '@/features/orders/utils/sale-draft';

describe('deriveSaleDraft', () => {
  it('supports price_vol mode with saleMode=USDT', () => {
    const draft = deriveSaleDraft({
      saleEntryMode: 'price_vol',
      saleMode: 'USDT',
      saleUsdtQty: '',
      saleAmount: '100',
      saleSell: '3.65',
      saleFee: '12',
    });

    expect(draft.quantityUsdt).toBe(100);
    expect(draft.sellPriceQar).toBe(3.65);
    expect(draft.revenueQar).toBe(365);
    expect(draft.feeQar).toBe(12);
  });

  it('supports price_vol mode with saleMode=QAR', () => {
    const draft = deriveSaleDraft({
      saleEntryMode: 'price_vol',
      saleMode: 'QAR',
      saleUsdtQty: '',
      saleAmount: '365',
      saleSell: '3.65',
      saleFee: '10',
    });

    expect(draft.quantityUsdt).toBe(100);
    expect(draft.sellPriceQar).toBe(3.65);
    expect(draft.revenueQar).toBe(365);
    expect(draft.feeQar).toBe(10);
  });

  it('supports qty_total mode', () => {
    const draft = deriveSaleDraft({
      saleEntryMode: 'qty_total',
      saleMode: 'USDT',
      saleUsdtQty: '100',
      saleAmount: '365',
      saleSell: '999',
      saleFee: '8',
    });

    expect(draft.quantityUsdt).toBe(100);
    expect(draft.sellPriceQar).toBe(3.65);
    expect(draft.revenueQar).toBe(365);
    expect(draft.feeQar).toBe(8);
  });

  it('supports qty_price mode', () => {
    const draft = deriveSaleDraft({
      saleEntryMode: 'qty_price',
      saleMode: 'USDT',
      saleUsdtQty: '100',
      saleAmount: '0',
      saleSell: '3.65',
      saleFee: '7',
    });

    expect(draft.quantityUsdt).toBe(100);
    expect(draft.sellPriceQar).toBe(3.65);
    expect(draft.revenueQar).toBe(365);
    expect(draft.feeQar).toBe(7);
  });
});
