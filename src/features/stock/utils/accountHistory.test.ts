import { describe, expect, it } from 'vitest';
import { balanceAsOf, buildHistoryLines, eventsFromEntries, eventsFromPublicStatement, findUnappliedClaims, historyView, type HistoryEvent } from './accountHistory';

const day = (d: number) => Date.UTC(2026, 10, d, 12);
const charge = (id: string, d: number, amount: number): HistoryEvent => ({ id, ts: day(d), kind: 'charge', amount, ref: id, description: '' });
const pay = (id: string, d: number, amount: number, groupId?: string): HistoryEvent => ({ id, ts: day(d), kind: 'payment', amount, ref: id, description: 'Customer-reported', groupId });

describe('buildHistoryLines', () => {
  it('shows the unpaid balance before and after every row', () => {
    const lines = buildHistoryLines([charge('o1', 1, 10000), pay('p1', 3, 4000), charge('o2', 5, 2500)]);
    expect(lines.map(l => [l.kind, l.before, l.amount, l.after])).toEqual([
      ['charge', 0, 10000, 10000],
      ['payment', 10000, 4000, 6000],
      ['charge', 6000, 2500, 8500],
    ]);
  });

  it('turns one payment split across several orders into one row', () => {
    const lines = buildHistoryLines([charge('a', 1, 40000), charge('b', 2, 30000), pay('r1', 4, 40000, 'batch'), pay('r2', 4, 10000, 'batch')]);
    const payment = lines[lines.length - 1];
    expect(lines).toHaveLength(3);
    expect(payment).toMatchObject({ kind: 'payment', amount: 50000, before: 70000, after: 20000, parts: 2 });
  });

  it('reads a charge before a payment made at the same moment', () => {
    const lines = buildHistoryLines([pay('p', 2, 400), charge('c', 2, 400)]);
    expect(lines.map(l => l.kind)).toEqual(['charge', 'payment']);
    expect(lines.every(l => l.after >= 0)).toBe(true);
  });

  it('keeps a balance below zero as credit when a payment is dated before the order it settles', () => {
    const lines = buildHistoryLines([pay('p', 1, 500), charge('c', 3, 800)]);
    expect(lines.map(l => l.after)).toEqual([-500, 300]);
  });

  it('ignores empty amounts and rounds to cents', () => {
    const lines = buildHistoryLines([charge('c', 1, 0.1), charge('d', 2, 0.2), pay('p', 3, 0), pay('q', 3, 0.3)]);
    expect(lines).toHaveLength(3);
    expect(lines[2].after).toBe(0);
  });
});

describe('historyView and balanceAsOf', () => {
  const lines = buildHistoryLines([charge('o1', 1, 10000), pay('p1', 10, 4000), charge('o2', 15, 2500), pay('p2', 20, 1000)]);

  it('opens a period with the balance left by everything before it', () => {
    const view = historyView(lines, day(12), day(25));
    expect(view.opening).toBe(6000);
    expect(view.lines.map(l => l.id)).toEqual(['o2', 'p2']);
    expect(view.charges).toBe(2500);
    expect(view.payments).toBe(1000);
    expect(view.closing).toBe(7500);
    expect(view.opening + view.charges - view.payments).toBe(view.closing);
  });

  it('keeps the opening balance as the closing balance of a quiet period', () => {
    const view = historyView(lines, day(2), day(5));
    expect(view).toMatchObject({ opening: 10000, closing: 10000, lines: [] });
  });

  it('answers what was unpaid on any past day', () => {
    expect(balanceAsOf(lines, day(0))).toBe(0);
    expect(balanceAsOf(lines, day(9))).toBe(10000);
    expect(balanceAsOf(lines, day(10))).toBe(6000);
    expect(balanceAsOf(lines, day(30))).toBe(7500);
  });
});

describe('adapters', () => {
  it('recomputes the balance of entries merged from several customer records', () => {
    // Each record's own running balance would restart at its own first row; the merged history must not.
    const events = eventsFromEntries([
      { id: 'c1', ts: day(1), kind: 'charge', debit: 5000, credit: 0, ref: 'A', description: '' },
      { id: 'c2', ts: day(2), kind: 'charge', debit: 3000, credit: 0, ref: 'B', description: '' },
      { id: 'p1', ts: day(3), kind: 'payment', debit: 0, credit: 2000, ref: 'B', description: '', batchId: 'x' },
    ]);
    expect(buildHistoryLines(events).map(l => l.after)).toEqual([5000, 8000, 6000]);
  });

  it('adds a rounding row when the buyer-facing figures are rounded', () => {
    const events = eventsFromPublicStatement({
      outstanding: 100,
      orders: [{ ref: 'A', date: day(1), amount: 10000, note: null }],
      payments: [{ date: day(2), amount: 9900, note: null, ref: null }],
    });
    // 10,000 - 9,900 = 100: nothing to absorb.
    expect(events.some(e => e.id === 'rounding')).toBe(false);
    const off = eventsFromPublicStatement({
      outstanding: 99,
      orders: [{ ref: 'A', date: day(1), amount: 10000, note: null }],
      payments: [{ date: day(2), amount: 9900, note: null, ref: null }],
    }, 'Rounding');
    const lines = buildHistoryLines(off);
    expect(lines[lines.length - 1]).toMatchObject({ description: 'Rounding', after: 99 });
  });
});

describe('findUnappliedClaims', () => {
  const claim = (id: string, batch: string | null, over: object = {}) => ({ id, customerId: 'c1', currency: 'QAR', amount: 17500, status: 'accepted', source: 'customer_claim', appliedBatchId: batch, note: null, paidAt: '2026-10-19T21:00:00Z', ...over });
  const entries = [{ kind: 'payment' as const, batchId: 'applied' }];

  it('flags an accepted payment whose batch left no repayment behind', () => {
    const found = findUnappliedClaims([claim('a', 'applied'), claim('b', 'lost')], entries, new Set(['c1']), 'QAR');
    expect(found.map(c => c.id)).toEqual(['b']);
  });

  it('leaves out other buyers, other currencies, pending claims and merchant-recorded payments', () => {
    const found = findUnappliedClaims([
      claim('x', 'lost', { customerId: 'other' }), claim('y', 'lost', { currency: 'EGP' }),
      claim('z', 'lost', { status: 'pending' }), claim('m', null, { source: 'merchant_payment' }), claim('n', null),
    ], entries, new Set(['c1']), 'QAR');
    expect(found).toEqual([]);
  });
});
