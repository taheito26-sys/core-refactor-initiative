import { describe, expect, it } from 'vitest';
import { canSpendFromAccount, getAccountBalance, type CashLedgerEntry } from '@/lib/tracker-helpers';
import { decodeOverdraftFlag, encodeOverdraftFlag } from '@/features/cash/account-overdraft';
import { accountToRow, rowToAccount } from '@/lib/cash-sync';

describe('accounts that may go negative', () => {
  it('blocks overspending unless the account allows a negative balance', () => {
    expect(canSpendFromAccount({}, 500, 11000)).toBe(false);
    expect(canSpendFromAccount({ allowNegative: false }, 500, 11000)).toBe(false);
    expect(canSpendFromAccount({ allowNegative: true }, 500, 11000)).toBe(true);
    expect(canSpendFromAccount({}, 11000, 11000)).toBe(true);
  });

  it('leaves 500 minus an 11,000 order at -10,500, which is owed to the account owner', () => {
    const ledger = [
      { id: '1', accountId: 'a', direction: 'in', amount: 500 },
      { id: '2', accountId: 'a', direction: 'out', amount: 11000 },
    ] as unknown as CashLedgerEntry[];
    expect(getAccountBalance('a', ledger)).toBe(-10500);
  });

  it('keeps the flag in the notes column and strips it back out', () => {
    expect(encodeOverdraftFlag('Abu Auni', true)).toBe('Abu Auni [[allow-negative]]');
    expect(encodeOverdraftFlag(null, true)).toBe('[[allow-negative]]');
    expect(encodeOverdraftFlag('plain', false)).toBe('plain');
    expect(decodeOverdraftFlag('Abu Auni [[allow-negative]]')).toEqual({ notes: 'Abu Auni', allowNegative: true });
    expect(decodeOverdraftFlag('[[allow-negative]]')).toEqual({ notes: null, allowNegative: true });
    expect(decodeOverdraftFlag('plain')).toEqual({ notes: 'plain', allowNegative: false });
  });

  it('survives a save to the cloud row and back', () => {
    const row = accountToRow({ id: 'a', name: 'Abu Auni', type: 'bank', currency: 'QAR', status: 'active', notes: 'n', allowNegative: true, createdAt: 1 }, 'u');
    expect(row.notes).toBe('n [[allow-negative]]');
    const back = rowToAccount(row as unknown as Record<string, unknown>);
    expect(back.allowNegative).toBe(true);
    expect(back.notes).toBe('n');
  });
});
