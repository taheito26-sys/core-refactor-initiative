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
  it('adds cash, bank and stock at cost, and values USD at the average USDT buying price', () => {
    const s = state({
      cashAccounts: [acc('hand', 'hand', 'QAR'), acc('bank', 'bank', 'QAR'), acc('usd', 'bank', 'USD')] as never,
      cashLedger: [led('hand', D(2026, 9, 1), 'in', 1000), led('bank', D(2026, 9, 1), 'in', 5000), led('usd', D(2026, 9, 1), 'in', 100)] as never,
      batches: [batch('b', D(2026, 9, 1), 1000, 3.6)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30));
    expect(line(p, 'cash_hand')).toBe(1000);
    expect(p.usdToQar).toBe(3.6);
    expect(line(p, 'cash_bank')).toBe(5000 + 100 * 3.6);
    expect(line(p, 'stock')).toBe(3600);
    expect(p.netQAR).toBe(1000 + 5000 + 360 + 3600);
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
      cashAccounts: [acc('egp', 'bank', 'EGP')] as never,
      cashLedger: [led('egp', D(2026, 9, 1), 'in', 5200)] as never,
    });
    const p = computeNetPosition(s, D(2026, 9, 30), { egpPerUsdt: 52 });
    expect(line(p, 'cash_bank')).toBe(100 * 3.6);
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
    // The sale's 19,000 lands in cash as sale proceeds and 18,000 of stock leaves: that is the 1,000 revenue, nothing extra.
    expect(b.depositsQAR).toBe(0);
    expect(b.otherQAR).toBe(0);
    expect(b.closingQAR).toBe(b.openingQAR + 1000 - 300 - 200 - 100);
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
    expect(withIds.depositsQAR).toBe(0);
  });

  describe('what sits between revenue and the change in position', () => {
    const month = (s: TrackerState) => computeMonthPosition(s, 2026, 8, {}, D(2026, 10, 15));

    it('counts a sale whose cash deposit came back from the cloud as a plain deposit as that sale\'s proceeds, not as money added', () => {
      const s = state({
        cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
        cashLedger: [
          led('hand', D(2026, 8, 20), 'in', 100000),
          { ...led('hand', D(2026, 9, 10), 'in', 19000), type: 'deposit', linkedEntityType: 'trade', linkedEntityId: 't' },
          led('hand', D(2026, 9, 12), 'in', 500),
        ] as never,
        batches: [batch('b', D(2026, 8, 20), 10000, 3.6)] as never,
        trades: [trade('t', D(2026, 9, 10), 5000, 3.8)] as never,
      });
      const b = computeMonthBridge(s, month(s));
      expect(b.depositsQAR).toBe(500);
      expect(b.salesUnreceivedQAR).toBe(0);
    });

    it('lists a sale with no cash deposit and no loan as proceeds that never arrived, and the position falls by them', () => {
      const s = state({
        cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
        cashLedger: [led('hand', D(2026, 8, 20), 'in', 100000)] as never,
        batches: [batch('b', D(2026, 8, 20), 10000, 3.6)] as never,
        trades: [trade('t', D(2026, 9, 10), 5000, 3.8)] as never,
      });
      const m = month(s);
      const b = computeMonthBridge(s, m);
      expect(b.salesUnreceivedQAR).toBe(19000);
      expect(b.diagnostics?.sales[0]).toMatchObject({ id: 't', missingQAR: 19000 });
      expect(b.otherQAR).toBe(0);
    });

    it('does not call a sale unreceived when it is a loan', () => {
      const s = state({
        cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
        cashLedger: [led('hand', D(2026, 8, 20), 'in', 100000)] as never,
        batches: [batch('b', D(2026, 8, 20), 10000, 3.6)] as never,
        trades: [trade('t', D(2026, 9, 10), 5000, 3.8)] as never,
        customerLoans: [{ id: 'l', ts: D(2026, 9, 10), customerId: 'c', tradeId: 't', principal: 19000, currency: 'QAR', repayments: [], status: 'open', createdAt: 0 }] as never,
      });
      const b = computeMonthBridge(s, month(s));
      expect(b.salesUnreceivedQAR).toBe(0);
      expect(b.otherQAR).toBe(0);
    });

    it('lists stock added with no payment recorded, and sales of USDT that was never in stock', () => {
      const s = state({
        cashAccounts: [acc('hand', 'hand', 'QAR')] as never,
        cashLedger: [led('hand', D(2026, 8, 20), 'in', 100000)] as never,
        batches: [batch('b', D(2026, 9, 2), 1000, 3.6)] as never,
        trades: [{ ...trade('t', D(2026, 9, 10), 500, 3.8), usesStock: false, manualBuyPrice: 3.6 }] as never,
      });
      const b = computeMonthBridge(s, month(s));
      expect(b.stockUnpaidQAR).toBe(3600);
      expect(b.outsideStockQAR).toBe(1800);
      expect(b.diagnostics?.unpaidStock[0].id).toBe('b');
    });
  });
});
