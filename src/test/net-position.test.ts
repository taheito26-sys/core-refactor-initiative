import { describe, expect, it } from 'vitest';
import { USD_QAR_PEG, computeMonthPosition, computeMonthlyPositions, computeNetPosition } from '@/lib/trading/net-position';
import type { TrackerState } from '@/lib/tracker-helpers';

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

const acc = (id: string, type: string, currency: string) => ({ id, name: id, type, currency, status: 'active', createdAt: 0 });
const led = (accountId: string, ts: number, direction: 'in' | 'out', amount: number) =>
  ({ id: `${accountId}-${ts}-${amount}-${direction}`, ts, type: 'deposit', accountId, direction, amount, currency: 'QAR' });
const batch = (id: string, ts: number, usdt: number, price: number) =>
  ({ id, ts, source: 'S', note: '', buyPriceQAR: price, initialUSDT: usdt, revisions: [] });
const trade = (id: string, ts: number, usdt: number, sell: number) =>
  ({ id, ts, inputMode: 'USDT', amountUSDT: usdt, sellPriceQAR: sell, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: 'c' });

const state = (over: Partial<TrackerState> = {}) =>
  ({ cashAccounts: [], cashLedger: [], batches: [], trades: [], customerLoans: [], deletedLoanIds: [], usdtTransfers: [], ...over }) as unknown as TrackerState;
const line = (p: ReturnType<typeof computeNetPosition>, key: string) => p.lines.find(l => l.key === key)?.amountQAR ?? 0;

describe('computeNetPosition', () => {
  it('adds cash, bank and stock at cost, and counts USD at the peg', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR'), acc('usd', 'bank', 'USD')] as never,
      cashLedger: [led('hand', D(2026, 9, 1), 'in', 1000), led('bank', D(2026, 9, 1), 'in', 5000), led('usd', D(2026, 9, 1), 'in', 100)] as never,
      batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(line(p, 'cash_hand')).toBe(1000);
    expect(line(p, 'cash_bank')).toBe(5000 + 100 * USD_QAR_PEG);
    expect(line(p, 'stock')).toBe(3600);
    expect(p.netQAR).toBe(1000 + 5000 + 364 + 3600);
  });

  it('leaves EGP accounts and EGP loans out and says so', () => {
    const s = state({
      cashAccounts: [acc('egp', 'bank', 'EGP')] as never,
      cashLedger: [led('egp', D(2026, 9, 1), 'in', 999999)] as never,
      customerLoans: [{ id: 'l', ts: D(2026, 9, 1), customerId: 'c', principal: 5000, currency: 'EGP', repayments: [], status: 'open', createdAt: 0 }] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(p.netQAR).toBe(0);
    expect(p.ignored).toEqual({ egpAccounts: 1, egpLoans: 1 });
  });

  it('values only what existed at the date: later cash, repayments and sales do not count', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
      cashLedger: [led('hand', D(2026, 9, 5), 'in', 1000), led('hand', D(2026, 10, 5), 'out', 400)] as never,
      customerLoans: [{
        id: 'l', ts: D(2026, 9, 2), customerId: 'c', principal: 2000, currency: 'QAR', status: 'open', createdAt: 0,
        repayments: [{ id: 'r', ts: D(2026, 10, 3), amount: 500 }],
      }] as never,
    });
    const sep = computeNetPosition(s, D(2026, 9, 30));
    expect(line(sep, 'cash_hand')).toBe(1000);
    expect(line(sep, 'customer_loans')).toBe(2000);
    const oct = computeNetPosition(s, D(2026, 10, 31));
    expect(line(oct, 'cash_hand')).toBe(600);
    expect(line(oct, 'customer_loans')).toBe(1500);
  });

  it('shows USDT lent as an asset and USDT borrowed as a liability, valued at the stock cost', () => {
    const s = state({
      batches: [batch('b', D(2026, 9, 1), 1000, 3.7)] as never,
      usdtTransfers: [
        { id: 't1', ts: D(2026, 9, 2), kind: 'lend_out', amountUSDT: 100, counterpartyName: 'Ahmed', createdAt: 0 },
        { id: 't2', ts: D(2026, 9, 3), kind: 'borrow_in', amountUSDT: 50, counterpartyName: 'Omar', createdAt: 0 },
      ] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(line(p, 'merchant_lent')).toBeGreaterThan(0);
    expect(line(p, 'merchant_borrowed')).toBeGreaterThan(0);
    expect(p.liabilitiesQAR).toBe(line(p, 'merchant_borrowed'));
  });

  it('counts an overdrawn account as owed, not owned', () => {
    const s = state({ cashAccounts: [acc('b', 'bank', 'QAR')] as never, cashLedger: [led('b', D(2026, 9, 1), 'out', 300)] as never });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(p.netQAR).toBe(-300);
  });
});

describe('monthly positions', () => {
  it('compares each month\'s change with its revenue and leaves the rest unexplained', () => {
    // 100,000 cash on 1 Sept; stock 10,000 USDT at 3.6; sell 5,000 at 3.8 => revenue 1,000; then 600 leaves cash with no sale.
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
      cashLedger: [
        led('hand', D(2026, 8, 20), 'in', 100000),
        led('hand', D(2026, 9, 10), 'in', 19000),
        led('hand', D(2026, 9, 20), 'out', 600),
      ] as never,
      batches: [batch('b', D(2026, 8, 20), 10000, 3.6)] as never,
      trades: [trade('t', D(2026, 9, 10), 5000, 3.8)] as never,
    });
    const m = computeMonthPosition(s, 2026, 8, {}, D(2026, 10, 15));
    expect(m.open).toBe(false);
    expect(m.netRevenueQAR).toBe(1000);
    expect(m.opening.netQAR).toBe(100000 + 36000);
    expect(m.changeQAR).toBe(1000 - 600);
    expect(m.unexplainedQAR).toBe(-600);
  });

  it('lists every month from the start month to the current one', () => {
    const months = computeMonthlyPositions(state(), '2026-08', {}, D(2026, 10, 15));
    expect(months.map(m => m.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(months[2].open).toBe(true);
  });
});
