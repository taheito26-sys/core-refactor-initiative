import { describe, expect, it } from 'vitest';

import { computeFIFO, kpiFor, totalStock, type Batch, type Trade, type TrackerState } from '@/lib/tracker-helpers';
import { tagBatch, tagExchangeOrder, tagExchangeTransfer, tagTrade, untagTransfer, TagError } from '@/features/stock/usdt-tagging';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';

function batch(id: string, ts: number, price: number, qty: number, source = ''): Batch {
  return { id, ts, source, note: '', buyPriceQAR: price, initialUSDT: qty, revisions: [] };
}

function trade(id: string, ts: number, qty: number, sell: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id, ts, inputMode: 'USDT', amountUSDT: qty, sellPriceQAR: sell, feeQAR: 0, note: '',
    voided: false, usesStock: true, revisions: [], customerId: 'c1', ...overrides,
  };
}

function makeState(batches: Batch[], trades: Trade[]): TrackerState {
  return {
    currency: 'QAR', range: 'all', batches, trades,
    customers: [{ id: 'c1', name: 'Ali', phone: '', tier: '', dailyLimitUSDT: 0, notes: '', createdAt: 0 }],
    suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [],
    customerLoans: [], usdtTransfers: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 0, selectedDay: null },
  };
}

const derive = (s: TrackerState) => computeFIFO(s.batches, s.trades, s.usdtTransfers);

describe('tagging existing records as borrow / lend', () => {
  // Day 1: bought 20k @ 3.695 and sent it to the lender, recorded as an order.
  // Day 2: bought 11k @ 3.685 and sold 11k @ 3.69.
  const base = makeState(
    [batch('d1', 20, 3.695, 20000), batch('d2', 30, 3.685, 11000)],
    [trade('repay', 21, 20000, 3.695), trade('sale', 31, 11000, 3.69)],
  );

  it('tagging an order as a repayment removes it from sales but keeps the stock outflow', () => {
    const { state } = tagTrade(base, 'repay', 'borrow_repay', 'Ali', 'repay');
    const d = derive(state);
    expect(state.trades.find(t => t.id === 'repay')).toMatchObject({ voided: true, usdtTransferKind: 'borrow_repay' });
    expect(d.tradeCalc.get('sale')!.netQAR).toBeCloseTo(55, 6);
    expect(d.transferCalc?.get('repay')?.totalCost).toBeCloseTo(20000 * 3.695, 6);
    expect(totalStock(d)).toBeCloseTo(0, 9);
    const k = kpiFor(state, d, 'all');
    expect(k.count).toBe(1);
    expect(k.rev).toBeCloseTo(11000 * 3.69, 6);
  });

  it('undo restores the order exactly', () => {
    const tagged = tagTrade(base, 'repay', 'borrow_repay', 'Ali', 'repay').state;
    const { state } = untagTransfer(tagged, 'repay');
    const tr = state.trades.find(t => t.id === 'repay')!;
    expect(tr.voided).toBe(false);
    expect(tr.usdtTransferKind).toBeUndefined();
    expect(derive(state).tradeCalc.get('sale')!.netQAR).toBeCloseTo(derive(base).tradeCalc.get('sale')!.netQAR, 9);
  });

  it('tagging a stock batch as borrowed prices it at the repayment cost, then undo restores the purchase', () => {
    // Borrowed 20k (imported as a batch at a guessed 3.70), sold it, then
    // bought 20k @ 3.695 and sent it back.
    const s0 = makeState(
      [batch('borrowed', 10, 3.70, 20000, 'Ali'), batch('d1', 20, 3.695, 20000)],
      [trade('s0', 11, 20000, 3.70), trade('repay', 21, 20000, 3.695)],
    );
    const s1 = tagBatch(s0, 'borrowed', 'borrow_in', 'Ali', 'tag-borrowed').state;
    const s2 = tagTrade(s1, 'repay', 'borrow_repay', 'Ali', 'repay').state;
    const d = derive(s2);
    expect(d.tradeCalc.get('s0')!.avgBuyQAR).toBeCloseTo(3.695, 9);
    expect(d.batches.find(b => b.id === 'tag-borrowed')?.isTransfer).toBe(true);
    expect(d.batches.find(b => b.id === 'borrowed')?.remainingUSDT).toBe(0);
    expect(totalStock(d)).toBeCloseTo(0, 9);

    const back = untagTransfer(s2, 'tag-borrowed').state;
    expect(derive(back).batches.find(b => b.id === 'tag-borrowed')).toBeUndefined();
    expect(derive(back).batches.find(b => b.id === 'borrowed')?.buyPriceQAR).toBe(3.70);
  });

  it('retagging after an undo reuses the same id without duplicating', () => {
    const a = tagTrade(base, 'repay', 'borrow_repay', 'Ali', 'repay').state;
    const b = untagTransfer(a, 'repay').state;
    const c = tagTrade(b, 'repay', 'lend_out', 'Omar', 'repay').state;
    expect(c.usdtTransfers!.filter(x => x.id === 'repay')).toHaveLength(1);
    expect(c.usdtTransfers!.find(x => x.id === 'repay')).toMatchObject({ kind: 'lend_out', counterpartyName: 'Omar' });
  });

  it('tags only part of an order: the rest stays a sale at the same price', () => {
    // A 95k order of which 41k was really a loan repayment.
    const s = makeState([batch('d1', 1, 3.69, 95000)], [trade('big', 2, 95000, 3.70)]);
    const { state } = tagTrade(s, 'big', 'borrow_repay', 'Ali', 'x1', 41000);
    const tr = state.trades.find(t => t.id === 'big')!;
    expect(tr.voided).toBe(false);
    expect(tr.amountUSDT).toBe(54000);
    const d = derive(state);
    expect(d.tradeCalc.get('big')!.netQAR).toBeCloseTo(54000 * 0.01, 6);
    expect(d.transferCalc?.get('x1')?.coveredQty).toBe(41000);
    expect(totalStock(d)).toBeCloseTo(0, 9);
    expect(kpiFor(state, d, 'all').rev).toBeCloseTo(54000 * 3.70, 6);

    // Undo gives the 41k back to the order.
    const back = untagTransfer(state, 'x1').state;
    expect(back.trades.find(t => t.id === 'big')!.amountUSDT).toBe(95000);
    // Two partial tags, then the remainder: the order ends up voided.
    const a = tagTrade(s, 'big', 'borrow_repay', 'Ali', 'p1', 41000).state;
    const b = tagTrade(a, 'big', 'lend_out', 'Omar', 'p2', 54000).state;
    expect(b.trades.find(t => t.id === 'big')).toMatchObject({ voided: true, usdtTransferKind: 'lend_out' });
    const c = untagTransfer(untagTransfer(b, 'p2').state, 'p1').state;
    expect(c.trades.find(t => t.id === 'big')).toMatchObject({ voided: false, amountUSDT: 95000 });
  });

  it('tags only part of a batch: the rest stays a purchase', () => {
    const s = makeState([batch('okx', 1, 3.69, 95000, 'OKX')], [trade('sale', 2, 54000, 3.70)]);
    const { state } = tagBatch(s, 'okx', 'borrow_in', 'Ali', 'b1', 41000);
    const d = derive(state);
    expect(d.batches.find(b => b.id === 'okx')?.initialUSDT).toBe(54000);
    expect(d.batches.find(b => b.id === 'b1')).toMatchObject({ isTransfer: true, initialUSDT: 41000 });
    expect(d.tradeCalc.get('sale')!.avgBuyQAR).toBeCloseTo(3.69, 9);
    expect(() => tagBatch(state, 'okx', 'borrow_in', 'Ali', 'b2', 60000)).toThrow(TagError);
  });

  it('refuses merchant-linked orders', () => {
    const s = makeState([batch('d1', 1, 3.7, 1000)], [trade('m', 2, 100, 3.8, { linkedRelId: 'rel' })]);
    expect(() => tagTrade(s, 'm', 'lend_out', 'X', 'm')).toThrow(TagError);
  });

  it('tagging an exchange transfer dismisses it, undo only undismisses what it dismissed', () => {
    const et = (id: string, dismissed: string | null): ExchangeTransfer => ({
      id, exchange: 'binance', kind: 'pay', direction: 'out', asset: 'USDT', amount: 20000, status: 'ok',
      reference: 'R1', counterparty: 'Ali', network: null, transfer_time: new Date(21).toISOString(),
      linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: dismissed, created_at: '',
    });
    const s = makeState([batch('d1', 20, 3.695, 20000), batch('d2', 30, 3.685, 11000)], [trade('sale', 31, 11000, 3.69)]);
    const tagged = tagExchangeTransfer(s, et('e1', null), 'borrow_repay', 'Ali', 'x1');
    expect(tagged.dismiss).toEqual(['e1']);
    expect(derive(tagged.state).tradeCalc.get('sale')!.netQAR).toBeCloseTo(55, 6);
    expect(untagTransfer(tagged.state, 'x1').undismiss).toEqual(['e1']);

    const pre = tagExchangeTransfer(s, et('e2', '2026-01-01'), 'borrow_repay', 'Ali', 'x2');
    expect(pre.dismiss).toEqual([]);
    expect(untagTransfer(pre.state, 'x2').undismiss).toEqual([]);
  });

  it('tags part of an unimported P2P order and records it as an order link', () => {
    const order: ExchangeP2POrder = {
      id: 'o1', exchange: 'okx', order_number: '777', side: 'sell', asset: 'USDT', fiat: 'QAR', amount: 95000,
      price: 3.7, total: 95000 * 3.7, status: 'completed', counterparty: 'Abu Tamim', order_time: new Date(21).toISOString(),
      linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '',
    };
    const s = makeState([batch('d1', 20, 3.695, 95000)], []);
    const r = tagExchangeOrder(s, order, 'borrow_repay', 'Abu Tamim', 'x1', 95000, 41000);
    expect(r.orderLinks).toEqual([{ orderId: 'o1', entityType: 'trade', entityId: 'x1', amount: 41000, label: 'Abu Tamim' }]);
    const d = derive(r.state);
    expect(d.transferCalc?.get('x1')?.coveredQty).toBe(41000);
    expect(totalStock(d)).toBeCloseTo(54000, 9);
    expect(untagTransfer(r.state, 'x1').removeOrderLinks).toEqual([{ orderId: 'o1', entityId: 'x1' }]);
    // A sell order can't be tagged as incoming, nor for more than is left.
    expect(() => tagExchangeOrder(s, order, 'borrow_in', 'X', 'x2', 95000)).toThrow(TagError);
    expect(() => tagExchangeOrder(s, order, 'borrow_repay', 'X', 'x3', 10000, 20000)).toThrow(TagError);
  });
});
