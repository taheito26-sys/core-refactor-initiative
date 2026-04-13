import { describe, expect, it } from 'vitest';
import { canSubmitWithStockCoverage, computeStockCoverage, deriveSaleDraft } from '@/features/orders/utils/sale-draft';
import { computeFIFO, type Batch, type Trade } from '@/lib/tracker-helpers';

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

  it('derives quantity from total QAR / entered sell price (not FIFO cost)', () => {
    const draft = deriveSaleDraft({
      saleEntryMode: 'price_vol',
      saleMode: 'QAR',
      saleUsdtQty: '',
      saleAmount: '100000',
      saleSell: '3.81',
      saleFee: '0',
    });

    expect(draft.quantityUsdt).toBeCloseTo(100000 / 3.81, 8);
    expect(draft.sellPriceQar).toBe(3.81);
    expect(draft.revenueQar).toBeCloseTo(100000, 6);
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

describe('stock coverage + insufficient FIFO handling', () => {
  it('sale exactly equal to available stock is covered', () => {
    const coverage = computeStockCoverage(100, 100);
    expect(coverage.stockShortfall).toBe(0);
    expect(canSubmitWithStockCoverage(coverage, true, false, false)).toBe(true);
  });

  it('sale less than available stock is covered', () => {
    const coverage = computeStockCoverage(100, 90);
    expect(coverage.stockShortfall).toBe(0);
    expect(canSubmitWithStockCoverage(coverage, true, false, false)).toBe(true);
  });

  it('sale greater than available stock is blocked when override is OFF', () => {
    const coverage = computeStockCoverage(100, 120);
    expect(coverage.stockShortfall).toBe(20);
    expect(canSubmitWithStockCoverage(coverage, true, false, false)).toBe(false);
  });

  it('sale greater than available stock is allowed only when override is ON and confirmed', () => {
    const coverage = computeStockCoverage(100, 120);
    expect(canSubmitWithStockCoverage(coverage, true, true, false)).toBe(false);
    expect(canSubmitWithStockCoverage(coverage, true, true, true)).toBe(true);
  });

  it('FIFO net/margin are not presented as fully derived when stock is insufficient', () => {
    const batches: Batch[] = [
      { id: 'b1', ts: 1, initialUSDT: 100, buyPriceQAR: 3.5, source: 'test', note: '', revisions: [] },
    ];
    const trades: Trade[] = [
      {
        id: 't1',
        ts: 2,
        inputMode: 'USDT',
        amountUSDT: 120,
        sellPriceQAR: 3.6,
        feeQAR: 0,
        note: '',
        voided: false,
        usesStock: true,
        revisions: [],
        customerId: '',
      },
    ];
    const calc = computeFIFO(batches, trades).tradeCalc.get('t1');
    expect(calc?.ok).toBe(false);
    expect(calc?.netQAR).toBe(0);
    expect(calc?.margin).toBe(0);
  });
});
