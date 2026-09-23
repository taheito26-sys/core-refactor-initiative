import { describe, expect, it } from 'vitest';

import { computeFIFO, kpiFor, totalStock, type Batch, type Trade, type TrackerState } from '@/lib/tracker-helpers';
import {
  applyLoanMove,
  buildMerchantStatements,
  canonicalMerchantName,
  merchantNet,
  planLoanMove,
  undoLoanMove,
  type LoanSource,
} from '@/features/stock/loan-ledger';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';

function batch(id: string, ts: number, price: number, qty: number): Batch {
  return { id, ts, source: '', note: '', buyPriceQAR: price, initialUSDT: qty, revisions: [] };
}
function trade(id: string, ts: number, qty: number, sell: number, overrides: Partial<Trade> = {}): Trade {
  return { id, ts, inputMode: 'USDT', amountUSDT: qty, sellPriceQAR: sell, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '', ...overrides };
}
function makeState(batches: Batch[] = [], trades: Trade[] = []): TrackerState {
  return {
    currency: 'QAR', range: 'all', batches, trades, customers: [], suppliers: [], cashQAR: 0, cashOwner: '',
    cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [], usdtTransfers: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 0, selectedDay: null },
  };
}
function xfer(id: string, direction: 'in' | 'out', amount: number, ts: number, dismissed: string | null = null): ExchangeTransfer {
  return {
    id, exchange: 'binance', kind: 'pay', direction, asset: 'USDT', amount, status: 'ok', reference: `R-${id}`,
    counterparty: 'Abu Tamim', network: null, transfer_time: new Date(ts).toISOString(), linked_entity_type: null,
    linked_entity_id: null, linked_at: null, dismissed_at: dismissed, created_at: '',
  };
}
function p2p(id: string, side: 'buy' | 'sell', amount: number, ts: number): ExchangeP2POrder {
  return {
    id, exchange: 'okx', order_number: `N${id}`, side, asset: 'USDT', fiat: 'QAR', amount, price: 3.69, total: amount * 3.69,
    status: 'completed', counterparty: 'x', order_time: new Date(ts).toISOString(), linked_entity_type: null,
    linked_entity_id: null, linked_at: null, created_at: '',
  };
}

let n = 0;
const ids = () => `id${++n}`;
const derive = (s: TrackerState) => computeFIFO(s.batches, s.trades, s.usdtTransfers);
const move = (s: TrackerState, src: LoanSource, name: string, amount?: number) =>
  applyLoanMove(s, src, name, amount ?? (src.type === 'exchange_transfer' ? src.transfer.amount : (src as { available: number }).available), ids, 1000);

describe('planLoanMove decides the meaning from direction + balance', () => {
  it('covers all four cases and crossing zero', () => {
    expect(planLoanMove(0, 'in', 20000).parts).toEqual([{ kind: 'borrow_in', amount: 20000 }]);
    expect(planLoanMove(20000, 'out', 20000)).toEqual({ parts: [{ kind: 'borrow_repay', amount: 20000 }], after: 0 });
    expect(planLoanMove(0, 'out', 15000).parts).toEqual([{ kind: 'lend_out', amount: 15000 }]);
    expect(planLoanMove(-15000, 'in', 15000).parts).toEqual([{ kind: 'lend_return', amount: 15000 }]);
    expect(planLoanMove(5000, 'out', 8000)).toEqual({
      parts: [{ kind: 'borrow_repay', amount: 5000 }, { kind: 'lend_out', amount: 3000 }],
      after: -3000,
    });
    expect(planLoanMove(-2000, 'in', 5000).parts).toEqual([{ kind: 'lend_return', amount: 2000 }, { kind: 'borrow_in', amount: 3000 }]);
  });
});

describe('end-to-end merchant loan scenarios', () => {
  it('1. borrow 20k by Pay, sell it, buy 25k @3.695, repay 20k: sale costed at 3.695, ledger settled', () => {
    let s = makeState([batch('buy25', 20, 3.695, 25000), batch('buy11', 30, 3.685, 11000)], [trade('s0', 11, 20000, 3.70), trade('s2', 31, 11000, 3.69)]);
    const r1 = move(s, { type: 'exchange_transfer', transfer: xfer('in1', 'in', 20000, 10) }, 'Abu Tamim');
    expect(r1.parts).toEqual([{ kind: 'borrow_in', amount: 20000 }]);
    expect(r1.dismiss).toEqual(['in1']);
    s = r1.state;
    expect(merchantNet(s.usdtTransfers, 'Abu Tamim')).toBe(20000);
    const r2 = move(s, { type: 'exchange_transfer', transfer: xfer('out1', 'out', 20000, 21) }, 'abu tamim');
    expect(r2.parts).toEqual([{ kind: 'borrow_repay', amount: 20000 }]);
    s = r2.state;
    const d = derive(s);
    expect(d.tradeCalc.get('s0')!.avgBuyQAR).toBeCloseTo(3.695, 9);
    expect(totalStock(d)).toBeCloseTo(5000, 9);
    const [st] = buildMerchantStatements(s.usdtTransfers);
    expect(st.net).toBe(0);
    expect(st.lines.map(l => l.balanceAfter)).toEqual([20000, 0]);
    expect(st.lines.every(l => !l.estimated)).toBe(true);
  });

  it('2. four repayments 10k+10k+3k+10k bring a 33k debt to zero', () => {
    let s = makeState([batch('b', 1, 3.69, 33000)]);
    s = move(s, { type: 'manual', direction: 'in', ts: 0 }, 'Abu Tamim', 33000).state;
    [10000, 10000, 3000, 10000].forEach((amt, i) => {
      s = move(s, { type: 'exchange_order', order: p2p(`o${i}`, 'sell', amt, 10 + i), available: amt }, 'Abu Tamim').state;
    });
    const [st] = buildMerchantStatements(s.usdtTransfers);
    expect(st.lines.map(l => l.balanceAfter)).toEqual([33000, 23000, 13000, 10000, 0]);
    expect(st.net).toBe(0);
  });

  it('3. lend 15k and get it back: no P&L, stock back at the same cost', () => {
    let s = makeState([batch('b1', 1, 3.70, 15000), batch('b2', 5, 3.80, 5000)], [trade('sale', 7, 20000, 3.85)]);
    s = move(s, { type: 'manual', direction: 'out', ts: 2 }, 'Omar', 15000).state;
    expect(merchantNet(s.usdtTransfers, 'Omar')).toBe(-15000);
    s = move(s, { type: 'manual', direction: 'in', ts: 6 }, 'Omar', 15000).state;
    expect(s.usdtTransfers!.map(x => x.kind)).toEqual(['lend_out', 'lend_return']);
    expect(derive(s).tradeCalc.get('sale')!.totalCost).toBeCloseTo(15000 * 3.70 + 5000 * 3.80, 6);
    expect(kpiFor(s, derive(s), 'all').count).toBe(1);
  });

  it('4. part of a 95k P2P order is a loan; the rest stays available for import', () => {
    const s = makeState([batch('b', 1, 3.69, 95000)]);
    const r = move(s, { type: 'exchange_order', order: p2p('big', 'sell', 95000, 5), available: 95000 }, 'Ali', 41000);
    expect(r.orderLinks).toEqual([expect.objectContaining({ orderId: 'big', amount: 41000 })]);
    expect(merchantNet(r.state.usdtTransfers, 'Ali')).toBe(-41000);
  });

  it('5. owing 5k and sending an 8k order: split into repayment + loan, undone together', () => {
    let s = makeState([batch('b', 1, 3.69, 20000)], [trade('t8', 5, 8000, 3.7)]);
    s = move(s, { type: 'manual', direction: 'in', ts: 0 }, 'Ali', 5000).state;
    const r = move(s, { type: 'trade', tradeId: 't8', available: 8000, ts: 5 }, 'Ali');
    expect(r.parts).toEqual([{ kind: 'borrow_repay', amount: 5000 }, { kind: 'lend_out', amount: 3000 }]);
    expect(r.netAfter).toBe(-3000);
    expect(r.state.trades.find(t => t.id === 't8')).toMatchObject({ voided: true });
    const groupIds = new Set(r.state.usdtTransfers!.filter(x => x.groupId).map(x => x.groupId));
    expect(groupIds.size).toBe(1);

    const partId = r.state.usdtTransfers!.find(x => x.kind === 'lend_out')!.id;
    const back = undoLoanMove(r.state, partId).state;
    expect(back.trades.find(t => t.id === 't8')).toMatchObject({ voided: false, amountUSDT: 8000 });
    expect(merchantNet(back.usdtTransfers, 'Ali')).toBe(5000);
  });

  it('5b. a split exchange transfer is dismissed once and undismissed once', () => {
    let s = makeState([batch('b', 1, 3.69, 20000)]);
    s = move(s, { type: 'manual', direction: 'in', ts: 0 }, 'Ali', 5000).state;
    const r = move(s, { type: 'exchange_transfer', transfer: xfer('t', 'out', 8000, 5) }, 'Ali');
    expect(r.dismiss).toEqual(['t']);
    const u = undoLoanMove(r.state, r.state.usdtTransfers![1].id);
    expect(u.undismiss).toEqual(['t']);
    expect(merchantNet(u.state.usdtTransfers, 'Ali')).toBe(5000);
  });

  it('6. undo of a wrong merchant puts the order back exactly', () => {
    const s = makeState([batch('b', 1, 3.69, 10000)], [trade('t', 5, 10000, 3.7)]);
    const r = move(s, { type: 'trade', tradeId: 't', available: 10000, ts: 5 }, 'Wrong');
    const back = undoLoanMove(r.state, r.state.usdtTransfers![0].id).state;
    expect(back.trades[0]).toMatchObject({ voided: false, amountUSDT: 10000 });
    expect(buildMerchantStatements(back.usdtTransfers)).toEqual([]);
  });

  it('marks borrowed USDT not yet repaid as estimated, costed at the latest purchase price', () => {
    let s = makeState([batch('old', 1, 3.60, 1000), batch('new', 50, 3.72, 1000)], [trade('s', 11, 3000, 3.75)]);
    s = move(s, { type: 'manual', direction: 'in', ts: 10 }, 'Ali', 3000).state;
    s = move(s, { type: 'manual', direction: 'out', ts: 60 }, 'Ali', 1000).state;
    const [st] = buildMerchantStatements(s.usdtTransfers);
    expect(st.lines[0].estimated).toBe(true);
    expect(st.net).toBe(2000);
  });

  it('refuses amounts larger than the record, or part of a transfer', () => {
    const s = makeState([batch('b', 1, 3.69, 10000)], [trade('t', 5, 1000, 3.7)]);
    expect(() => applyLoanMove(s, { type: 'trade', tradeId: 't', available: 1000, ts: 5 }, 'A', 2000, ids)).toThrow();
    expect(() => applyLoanMove(s, { type: 'exchange_transfer', transfer: xfer('t', 'out', 1000, 5) }, 'A', 500, ids)).toThrow();
  });
});

describe('canonicalMerchantName', () => {
  it('reuses the existing spelling', () => {
    expect(canonicalMerchantName('  abu   tamim ', ['Abu Tamim', 'Omar'])).toBe('Abu Tamim');
    expect(canonicalMerchantName('New Guy', ['Abu Tamim'])).toBe('New Guy');
  });
});
