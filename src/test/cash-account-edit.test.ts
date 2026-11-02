import { describe, expect, it } from 'vitest';
import { editCashAccount } from '@/features/cash/edit-account';
import { createEmptyState } from '@/lib/tracker-state';
import { getAccountBalance, type CashAccount, type TrackerState } from '@/lib/tracker-helpers';
import { flowKindOf } from '@/lib/trading/cash-flow';

const account: CashAccount = { id: 'cash', name: 'Cash', currency: 'QAR', type: 'hand', status: 'active', createdAt: 1 };
const initial = (): TrackerState => ({ ...createEmptyState().state, cashAccounts: [account], cashLedger: [{ id: 'opening', ts: 1, type: 'opening', direction: 'in', accountId: 'cash', amount: 1000, currency: 'QAR' }] });
describe('direct account balance editing', () => {
  it.each([1500, 600, 0, -100])('sets the balance to %s without recording a deposit or withdrawal', target => {
    const state = initial();
    const next = editCashAccount(state, { ...account, name: 'Edited cash' }, target, 100);
    expect(getAccountBalance('cash', next.cashLedger)).toBe(target);
    expect(next.cashQAR).toBe(target);
    expect(next.cashAccounts[0].name).toBe('Edited cash');
    expect(next.cashAccounts[0].lastReconciled).toBe(100);
    expect(next.cashLedger[0]).toEqual(state.cashLedger[0]);
    expect(next.cashLedger[1].type).toBe('reconcile');
    expect(flowKindOf(next.cashLedger[1])).toBe('adjustment');
    expect(getAccountBalance('cash', JSON.parse(JSON.stringify(next)).cashLedger)).toBe(target);
    expect(state.cashLedger).toHaveLength(1);
  });
  it('does not add a correction when only account details change or the balance stays the same', () => {
    expect(editCashAccount(initial(), { ...account, bankName: 'Bank' }).cashLedger).toHaveLength(1);
    expect(editCashAccount(initial(), account, 1000).cashLedger).toHaveLength(1);
  });
  it('preserves other accounts and previous cash-flow history', () => {
    const other = { ...account, id: 'bank', name: 'Bank', type: 'bank' as const };
    const state = initial(); state.cashAccounts.push(other);
    state.cashLedger.push({ ...state.cashLedger[0], id: 'bank-opening', accountId: 'bank', amount: 250 });
    const next = editCashAccount(state, account, 500);
    expect(getAccountBalance('bank', next.cashLedger)).toBe(250);
    expect(next.cashQAR).toBe(750);
    expect(next.cashHistory).toEqual(state.cashHistory);
  });
  it('rejects invalid amounts and deleted accounts', () => {
    expect(() => editCashAccount(initial(), account, NaN)).toThrow('valid balance');
    expect(() => editCashAccount(initial(), account, Infinity)).toThrow('valid balance');
    expect(() => editCashAccount(initial(), { ...account, id: 'deleted' }, 100)).toThrow('no longer exists');
  });
  it('reuses a correction on retry, including after a lost response or a changed target', () => {
    const accepted = editCashAccount(initial(), account, 600, 100, 'retry-id');
    const retry = editCashAccount(accepted, account, 600, 200, 'retry-id');
    expect(retry.cashLedger).toHaveLength(2);
    expect(getAccountBalance('cash', retry.cashLedger)).toBe(600);
    const changed = editCashAccount(retry, account, 500, 300, 'retry-id');
    expect(changed.cashLedger).toHaveLength(2);
    expect(getAccountBalance('cash', changed.cashLedger)).toBe(500);
  });

});
