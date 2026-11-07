import { describe, expect, it } from 'vitest';
import { buildStateFrom } from '@/lib/tracker-state';
import type { CashLedgerEntry } from '@/lib/tracker-helpers';
import { buildCashFlow, cashFlowWindow } from '@/features/cash/cash-flow-model';
const now = new Date(2026, 9, 28, 12).getTime();
const entry = (id: string, extra: Partial<CashLedgerEntry> = {}): CashLedgerEntry => ({ id, ts: now - 1000, accountId: 'cash', type: 'deposit', currency: 'QAR', amount: 100, direction: 'in', ...extra });
const accounts = [{ id: 'cash', name: 'Cash', type: 'hand' as const, currency: 'QAR' as const, status: 'active' as const, createdAt: 1 }, { id: 'bank', name: 'Bank', type: 'bank' as const, currency: 'QAR' as const, status: 'active' as const, createdAt: 1 }];
describe('cash workspace flow', () => {
  it('keeps currencies separate and excludes internal transfers, opening balances and future rows', () => {
    const { state } = buildStateFrom({ cashAccounts: accounts, cashLedger: [entry('deposit'), entry('expense', { type: 'withdrawal', direction: 'out', amount: 30 }), entry('move-out', { type: 'transfer_out', contraAccountId: 'bank', direction: 'out' }), entry('move-in', { type: 'transfer_in', accountId: 'bank', contraAccountId: 'cash' }), entry('opening', { type: 'opening', amount: 500 }), entry('future', { ts: now + 1 }), entry('egp', { currency: 'EGP', amount: 2000 })] });
    const flow = buildCashFlow(state, now, '30d');
    expect(flow.inflow).toBe(100); expect(flow.outflow).toBe(30);
    expect(flow.bins.reduce((s, b) => s + b.inflow, 0)).toBe(100);
    expect(flow.recent.some(e => e.type === 'transfer_in' || e.id === 'future')).toBe(false);
  });
  it('changes the flow window without changing the account ledger', () => {
    const { state } = buildStateFrom({ cashAccounts: accounts, cashLedger: [entry('old', { ts: now - 10 * 86400000 }), entry('new')] });
    expect(buildCashFlow(state, now, '7d').inflow).toBe(100);
    expect(buildCashFlow(state, now, '30d').inflow).toBe(200);
    expect(state.cashLedger).toHaveLength(2);
  });
  it('bounds last month to that calendar month and handles empty all-time history', () => {
    expect(cashFlowWindow([], now, 'last_month')).toEqual({ start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 9, 1).getTime() - 1 });
    expect(cashFlowWindow([], now, 'all')).toEqual({ start: now, end: now });
  });
});
