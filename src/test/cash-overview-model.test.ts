import { describe, expect, it } from 'vitest';
import type { CashAccount, CashAccountType, CashCurrency, CashLedgerEntry, CustomerLoan } from '@/lib/tracker-helpers';
import { buildStateFrom } from '@/lib/tracker-state';
import { buildCashOverview } from '@/features/cash/cash-overview-model';
const now = new Date(2026, 9, 29, 12).getTime();
const ts = new Date(2026, 8, 25, 12).getTime();
const account = (id: string, type: CashAccountType = 'hand', currency: CashCurrency = 'QAR', status: CashAccount['status'] = 'active'): CashAccount => ({ id, name: id, type, currency, status, createdAt: ts });
const entry = (id: string, accountId: string, amount: number, extra: Partial<CashLedgerEntry> = {}): CashLedgerEntry => ({ id, accountId, amount, ts, currency: 'QAR', direction: 'in', type: 'deposit', ...extra });

describe('cash overview real account figures', () => {
  it('excludes inactive, custody and foreign accounts from the cash KPI and scopes shares by currency', () => {
    const { state } = buildStateFrom({ cashAccounts: [account('hand'), account('bank', 'bank'), account('custody', 'merchant_custody'), account('dollar', 'hand', 'USD'), account('old', 'bank', 'QAR', 'inactive')], cashLedger: [entry('1', 'hand', 80), entry('2', 'bank', 20), entry('3', 'custody', 400), entry('4', 'dollar', 10), entry('5', 'old', 90)] });
    const data = buildCashOverview(state, now);
    expect(data.total.balance).toBe(100); expect(data.hand.balance).toBe(80); expect(data.banks.balance).toBe(20);
    expect(data.rows.find(r => r.account.id === 'hand')?.share).toBe(80);
    expect(data.rows.find(r => r.account.id === 'dollar')?.share).toBe(100);
    expect(data.rows.find(r => r.account.id === 'custody')?.share).toBeNull();
  });
  it('uses ledger movements for month changes, daily changes and trend data', () => {
    const { state } = buildStateFrom({ cashAccounts: [account('bank', 'bank')], cashLedger: [entry('start', 'bank', 100), entry('out', 'bank', 25, { direction: 'out', ts: now - 1000 })], batches: [{ id: 'batch', fundingAccountId: 'bank', ts, source: '', note: '', buyPriceQAR: 3.7, initialUSDT: 1, revisions: [] }] });
    const row = buildCashOverview(state, now).rows[0];
    expect(row.balance).toBe(75); expect(row.change).toBe(-25); expect(row.movement).toBe(-25); expect(row.batches).toBe(1);
    expect(row.trend[row.trend.length - 1]).toBe(75); expect(row.trend[0]).toBe(100);
  });
  it('keeps loan currencies separate and omits deleted loans', () => {
    const loan = (id: string, currency: CashCurrency, principal: number, paid: number): CustomerLoan => ({ id, customerId: 'c', ts, principal, currency, status: 'open', createdAt: ts, repayments: [{ id: `r-${id}`, ts: now - 1000, amount: paid }] });
    const { state } = buildStateFrom({ customerLoans: [loan('q', 'QAR', 1000, 600), loan('u', 'USD', 100, 20), loan('gone', 'QAR', 9000, 0)], deletedLoanIds: ['gone'] });
    const data = buildCashOverview(state, now);
    expect(data.loan).toMatchObject({ currency: 'QAR', given: 1000, repaid: 600, remaining: 400, percent: 60 });
    expect(data.otherLoans).toEqual([{ currency: 'USD', given: 100, repaid: 20, remaining: 80 }]);
  });
  it('does not invent growth when there is no previous balance', () => {
    const { state } = buildStateFrom({ cashAccounts: [account('new')], cashLedger: [entry('new-cash', 'new', 50, { ts: now })] });
    expect(buildCashOverview(state, now).rows[0].change).toBeNull();
  });
});
