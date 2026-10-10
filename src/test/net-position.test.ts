import { describe, expect, it } from 'vitest';
import { USD_QAR_PEG, computeMonthBridge, loanLedgerEntryIds, computeMonthPosition, computeMonthlyPositions, computeNetPosition } from '@/lib/trading/net-position';
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
  it('counts cash in hand and money in banks, never vault accounts or USDT stock, and values USD at the average USDT buying price', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR'), acc('usd', 'hand', 'USD')] as never,
      cashLedger: [led('hand', D(2026, 9, 1), 'in', 1000), led('bank', D(2026, 9, 1), 'in', 5000), led('usd', D(2026, 9, 1), 'in', 100)] as never,
      batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(line(p, 'cash_hand')).toBe(1000 + 100 * 3.6);
    expect(p.usdToQar).toBe(3.6);
    expect(p.lines.map(l => l.key).sort()).toEqual(['cash_bank', 'cash_hand']);
    expect(line(p, 'cash_bank')).toBe(5000);
    expect(p.netQAR).toBe(1000 + 360 + 5000);
    expect(computeNetPosition(s, D(2026, 9, 30), { usdToQar: 3.7 }).usdToQar).toBe(3.7);
    expect(computeNetPosition(state(), D(2026, 9, 30)).usdToQar).toBe(USD_QAR_PEG);
  });

  it('counts an EGP loan by the USDT it cost at its own sale rate, priced at the USDT buying price', () => {
    // 1,000 USDT sold at 50 EGP/USDT = 50,000 EGP owed; 20,000 repaid; 30,000 EGP left = 600 USDT = 2,160 QAR at 3.6.
    const s = state({
      batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never,
      trades: [{ ...trade('t', D(2026, 9, 2), 1000, 3.8), originalFiat: 'EGP', originalFiatPriceUSDT: 50, originalFiatAmount: 50000 }] as never,
      customerLoans: [{
        id: 'l', ts: D(2026, 9, 2), customerId: 'c', tradeId: 't', principal: 50000, currency: 'EGP', status: 'open', createdAt: 0,
        repayments: [{ id: 'r', ts: D(2026, 9, 10), amount: 20000 }],
      }] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(p.warnings).toEqual([]);
    expect(line(p, 'customer_loans')).toBe(0 + 30000 / 50 * p.usdtRateQAR);
  });

  it('lets the EGP rate be overridden, and prices EGP cash by it', () => {
    const s = state({
      batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never,
      cashAccounts: [acc('egp', 'hand', 'EGP')] as never,
      cashLedger: [led('egp', D(2026, 9, 1), 'in', 5200)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30), { egpPerUsdt: 52 });
    expect(line(p, 'cash_hand')).toBe(100 * 3.6);
    expect(computeNetPosition(s, D(2026, 9, 30)).warnings).toContain('egp_unpriced');
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

  it('does not count USDT lent to or borrowed from merchants', () => {
    const s = state({
      batches: [batch('b', D(2026, 9, 1), 1000, 3.7)] as never,
      usdtTransfers: [
        { id: 't1', ts: D(2026, 9, 2), kind: 'lend_out', amountUSDT: 100, counterpartyName: 'Ahmed', createdAt: 0 },
        { id: 't2', ts: D(2026, 9, 3), kind: 'borrow_in', amountUSDT: 50, counterpartyName: 'Omar', createdAt: 0 },
      ] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(p.lines).toEqual([]);
    expect(p.netQAR).toBe(0);
  });

  it('counts only the live USDT balance on the exchanges, never USDT coming in or going out', () => {
    const s = state({ batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never });
    const exchangeUsdt = { nowUSDT: 800 };
    const now = D(2026, 10, 5);
    expect(line(computeNetPosition(s, now, { exchangeUsdt, now }), 'exchange_usdt')).toBe(800 * 3.6);
    // Any earlier moment has no exchange figure: nothing is worked back from movements.
    expect(line(computeNetPosition(s, D(2026, 10, 1), { exchangeUsdt, now }), 'exchange_usdt')).toBe(0);
    expect(line(computeNetPosition(s, D(2026, 9, 10), { exchangeUsdt, now }), 'exchange_usdt')).toBe(0);
  });

  it('counts an overdrawn account as owed, not owned', () => {
    const s = state({ cashAccounts: [acc('b', 'hand', 'QAR')] as never, cashLedger: [led('b', D(2026, 9, 1), 'out', 300)] as never });
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
    expect(m.opening.netQAR).toBe(100000);
    expect(m.changeQAR).toBe(19000 - 600);
    expect(m.unexplainedQAR).toBe(19000 - 600 - 1000);
  });

  it('lists every month from the start month to the current one', () => {
    const months = computeMonthlyPositions(state(), '2026-08', {}, D(2026, 10, 15));
    expect(months.map(m => m.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(months[2].open).toBe(true);
  });
});

describe('computeMonthBridge', () => {
  const bridgeState = () => state({
    cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
    cashLedger: [
      led('hand', D(2026, 8, 20), 'in', 100000),
      { ...led('hand', D(2026, 9, 10), 'in', 19000), type: 'sale_deposit', tradeId: 't' },
      { ...led('hand', D(2026, 9, 12), 'out', 300), type: 'withdrawal', expenseCategory: 'rent' },
      { ...led('hand', D(2026, 9, 13), 'out', 200), type: 'withdrawal', expenseCategory: 'owner_draw' },
      { ...led('hand', D(2026, 9, 14), 'out', 100), type: 'withdrawal' },
    ] as never,
    batches: [batch('b', D(2026, 8, 20), 10000, 3.6)] as never,
    trades: [trade('t', D(2026, 9, 10), 5000, 3.8)] as never,
  });

  it('separates business expenses, personal money and uncategorised withdrawals, and explains the whole change', () => {
    const s = bridgeState();
    const m = computeMonthPosition(s, 2026, 8, {}, D(2026, 10, 15));
    const b = computeMonthBridge(s, m);
    expect(b.business).toEqual([{ key: 'rent', amountQAR: 300 }]);
    expect(b.personal).toEqual([{ key: 'owner_draw', amountQAR: 200 }]);
    expect(b.uncategorisedQAR).toBe(100);
    expect(b.uncategorisedCount).toBe(1);
    expect(b.netRevenueQAR).toBe(1000);
    expect(b.openingQAR).toBe(100000);
    expect(b.closingQAR).toBe(m.closing.netQAR);
    // The position is cash in hand only: the sale's 19,000 less the three withdrawals.
    expect(b.closingQAR).toBe(100000 + 19000 - 300 - 200 - 100);
  });

  it('does not read a loan\'s cash movements as spending or money added, even when the cloud stored them as plain withdrawals', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
      cashLedger: [
        led('hand', D(2026, 8, 20), 'in', 10000),
        { ...led('hand', D(2026, 9, 5), 'out', 7000), id: 'give', type: 'withdrawal' },
        { ...led('hand', D(2026, 9, 25), 'in', 1000), id: 'back', type: 'deposit' },
      ] as never,
      customerLoans: [{ id: 'l', ts: D(2026, 9, 5), customerId: 'c', principal: 7000, currency: 'QAR', status: 'open', createdAt: 0, disbursementLedgerEntryId: 'give', repayments: [{ id: 'r', ts: D(2026, 9, 25), amount: 1000, ledgerEntryId: 'back' }] }] as never,
    });
    const m = computeMonthPosition(s, 2026, 8, {}, D(2026, 10, 15));
    const without = computeMonthBridge(s, m);
    expect(without.uncategorisedQAR).toBe(7000);
    const withIds = computeMonthBridge(s, m, loanLedgerEntryIds(s.customerLoans, []));
    expect(withIds.uncategorisedQAR).toBe(0);
  });

});

describe('what each line is made of', () => {
  it('names the accounts and people behind a line, with an overdrawn account taking away from cash in hand', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR'), acc('b', 'hand', 'QAR')] as never,
      cashLedger: [led('hand', D(2026, 9, 1), 'in', 1000), led('b', D(2026, 9, 1), 'out', 431)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30), { personalLoans: [{ id: 'p', person: 'Friend', principal: 7000, currency: 'QAR', lentAt: D(2026, 9, 5), repayments: [] }] });
    expect(p.details?.cash_hand?.[0]).toMatchObject({ label: 'hand', amountQAR: 1000 });
    expect(p.details?.cash_hand?.[1]).toMatchObject({ label: 'b (overdrawn)', amountQAR: 431 });
    expect(line(p, 'cash_hand')).toBe(1000 - 431);
    expect(p.details?.personal_loans?.[0].label).toBe('Friend');
  });
});

describe('the position is five things', () => {
  it('is cash in hand, money in banks, USDT in exchanges, customer loans and personal loans, nothing else', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR')] as never,
      cashLedger: [led('hand', D(2026, 9, 1), 'in', 1000), led('bank', D(2026, 9, 1), 'in', 9000)] as never,
      batches: [batch('s', D(2026, 9, 1), 1000, 3.6)] as never,
      customerLoans: [{ id: 'l', ts: D(2026, 9, 2), customerId: 'c', principal: 2000, currency: 'QAR', status: 'open', createdAt: 0, repayments: [] }] as never,
    });
    const now = D(2026, 9, 30);
    const p = computeNetPosition(s, now, {
      now,
      exchangeUsdt: { nowUSDT: 10 },
      personalLoans: [{ id: 'p', person: 'Friend', principal: 500, currency: 'QAR', lentAt: D(2026, 9, 5), repayments: [] }],
    });
    expect(p.lines.map(l => l.key).sort()).toEqual(['cash_bank', 'cash_hand', 'customer_loans', 'exchange_usdt', 'personal_loans']);
    expect(p.netQAR).toBe(1000 + 9000 + 36 + 2000 + 500);
  });
});
