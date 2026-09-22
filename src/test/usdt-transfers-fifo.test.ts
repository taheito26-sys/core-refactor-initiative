import { describe, expect, it } from 'vitest';

import { computeFIFO, kpiFor, totalStock, type Batch, type Trade, type TrackerState } from '@/lib/tracker-helpers';
import {
  getUsdtTransferBalances,
  mergeTransfersByRecency,
  type UsdtTransfer,
} from '@/lib/usdt-transfers';

function batch(id: string, ts: number, price: number, qty: number): Batch {
  return { id, ts, source: '', note: '', buyPriceQAR: price, initialUSDT: qty, revisions: [] };
}

function trade(id: string, ts: number, qty: number, sell: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id, ts, inputMode: 'USDT', amountUSDT: qty, sellPriceQAR: sell, feeQAR: 0, note: '',
    voided: false, usesStock: true, revisions: [], customerId: '', ...overrides,
  };
}

function xfer(id: string, ts: number, kind: UsdtTransfer['kind'], qty: number, overrides: Partial<UsdtTransfer> = {}): UsdtTransfer {
  return { id, ts, kind, amountUSDT: qty, counterpartyName: 'Ali', createdAt: ts, ...overrides };
}

describe('computeFIFO with USDT borrow/lend transfers', () => {
  it('is unchanged when there are no transfers', () => {
    const batches = [batch('b1', 1, 3.7, 1000), batch('b2', 2, 3.72, 1000)];
    const trades = [trade('t1', 3, 1500, 3.75)];
    const before = computeFIFO(batches, trades);
    const after = computeFIFO(batches, trades, []);
    expect(after.tradeCalc.get('t1')).toEqual(before.tradeCalc.get('t1'));
    expect(after.batches).toEqual(before.batches);
  });

  it('a repayment of borrowed USDT removes it from stock so the next sale is costed on the new buy (reported -55 loss)', () => {
    // Day 1: bought 20k @ 3.695 and sent all of it back to the lender.
    // Day 2: bought 11k @ 3.685 and sold 11k @ 3.69.
    const batches = [batch('d1', 20, 3.695, 20000), batch('d2', 30, 3.685, 11000)];
    const trades = [trade('sale', 31, 11000, 3.69)];

    const without = computeFIFO(batches, trades).tradeCalc.get('sale')!;
    expect(without.netQAR).toBeCloseTo(-55, 6);

    const withRepay = computeFIFO(batches, trades, [xfer('repay', 21, 'borrow_repay', 20000)]);
    const sale = withRepay.tradeCalc.get('sale')!;
    expect(sale.ok).toBe(true);
    expect(sale.avgBuyQAR).toBeCloseTo(3.685, 9);
    expect(sale.netQAR).toBeCloseTo(55, 6);
    expect(totalStock(withRepay)).toBeCloseTo(0, 9);
    // The repayment itself is costed at FIFO but is not a trade.
    expect(withRepay.transferCalc?.get('repay')?.totalCost).toBeCloseTo(20000 * 3.695, 6);
    expect(withRepay.tradeCalc.has('repay')).toBe(false);
  });

  it('prices borrowed USDT at the cost of the stock bought to repay it', () => {
    // Borrowed 20k with no stock, sold it, then bought 25k @ 3.695 and repaid 20k.
    const batches = [batch('d1', 20, 3.695, 25000), batch('d2', 30, 3.685, 11000)];
    const trades = [trade('s0', 11, 20000, 3.70), trade('s2', 31, 11000, 3.69)];
    const transfers = [xfer('in', 10, 'borrow_in', 20000), xfer('repay', 21, 'borrow_repay', 20000)];
    const d = computeFIFO(batches, trades, transfers);

    const s0 = d.tradeCalc.get('s0')!;
    expect(s0.ok).toBe(true);
    expect(s0.avgBuyQAR).toBeCloseTo(3.695, 9);
    expect(s0.netQAR).toBeCloseTo(20000 * (3.70 - 3.695), 6);

    // 5k of the 3.695 buy really is still on hand, so FIFO sells it first.
    const s2 = d.tradeCalc.get('s2')!;
    expect(s2.netQAR).toBeCloseTo(5000 * (3.69 - 3.695) + 6000 * (3.69 - 3.685), 6);
    // 20k borrowed + 25k + 11k bought, 20k + 11k sold, 20k repaid.
    expect(totalStock(d)).toBeCloseTo(5000, 9);
  });

  it('uses the reference price for a borrow that is not repaid yet', () => {
    const d = computeFIFO(
      [],
      [trade('s0', 11, 1000, 3.70)],
      [xfer('in', 10, 'borrow_in', 1000, { refPriceQAR: 3.68 })],
    );
    expect(d.tradeCalc.get('s0')!.avgBuyQAR).toBeCloseTo(3.68, 9);
  });

  it('lending out and getting it back is P&L-neutral and restores the original cost', () => {
    const batches = [batch('b1', 1, 3.70, 10000), batch('b2', 5, 3.80, 10000)];
    const transfers = [xfer('out', 2, 'lend_out', 10000), xfer('back', 6, 'lend_return', 10000)];
    const trades = [trade('s', 7, 20000, 3.85)];
    const d = computeFIFO(batches, trades, transfers);
    const s = d.tradeCalc.get('s')!;
    expect(s.ok).toBe(true);
    // Same total cost as if the USDT had never left: 10k @ 3.70 + 10k @ 3.80.
    expect(s.totalCost).toBeCloseTo(10000 * 3.70 + 10000 * 3.80, 6);
  });

  it('keeps transfers out of order revenue and profit KPIs', () => {
    const batches = [batch('b1', 1, 3.70, 10000)];
    const transfers = [xfer('out', 2, 'lend_out', 4000)];
    const trades = [trade('s', 3, 1000, 3.75)];
    const state = { trades, batches, range: 'all' } as unknown as TrackerState;
    const d = computeFIFO(batches, trades, transfers);
    const k = kpiFor(state, d, 'all');
    expect(k.count).toBe(1);
    expect(k.qty).toBe(1000);
    expect(k.net).toBeCloseTo(1000 * 0.05, 6);
    expect(totalStock(d)).toBeCloseTo(5000, 9);
  });

  it('ignores voided transfers', () => {
    const batches = [batch('d1', 20, 3.695, 20000)];
    const d = computeFIFO(batches, [], [xfer('repay', 21, 'borrow_repay', 20000, { voided: true })]);
    expect(totalStock(d)).toBe(20000);
  });
});

describe('USDT transfer balances and merge', () => {
  it('nets borrow/repay and lend/return per counterparty', () => {
    const rows = getUsdtTransferBalances([
      xfer('a', 1, 'borrow_in', 20000),
      xfer('b', 2, 'borrow_repay', 15000),
      xfer('c', 3, 'lend_out', 5000, { counterpartyName: 'Omar' }),
      xfer('d', 4, 'lend_out', 1000, { counterpartyName: 'Omar', voided: true }),
    ]);
    const ali = rows.find(r => r.counterpartyName === 'Ali')!;
    const omar = rows.find(r => r.counterpartyName === 'Omar')!;
    expect(ali.owedToThem).toBe(5000);
    expect(ali.owedToMe).toBe(0);
    expect(omar.owedToMe).toBe(5000);
  });

  it('keeps the most recently updated copy when merging', () => {
    const stale = xfer('a', 1, 'borrow_in', 100, { updatedAt: 1 });
    const voided = { ...stale, voided: true, updatedAt: 2 };
    expect(mergeTransfersByRecency([voided], [stale])[0].voided).toBe(true);
    expect(mergeTransfersByRecency([stale], [voided])[0].voided).toBe(true);
  });
});
