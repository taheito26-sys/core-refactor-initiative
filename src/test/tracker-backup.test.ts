import { describe, it, expect } from 'vitest';

import { findTrackerStorageKey, getCurrentTrackerState, hasMeaningfulTrackerData, normalizeImportedTrackerState } from '@/lib/tracker-backup';
import { mergeLocalAndCloud } from '@/lib/tracker-state';

describe('tracker backup state detection', () => {
  it('treats cash-only tracker data as real exportable state', () => {
    const cashOnly = {
      cashAccounts: [{ id: 'cash-1', name: 'Vault', type: 'vault', currency: 'QAR', status: 'active', createdAt: 1 }],
      cashLedger: [{ id: 'led-1', ts: 1, type: 'deposit', accountId: 'cash-1', direction: 'in', amount: 100, currency: 'QAR' }],
      cashHistory: [{ id: 'hist-1', ts: 1, type: 'deposit', amount: 100, balanceAfter: 100, owner: 'owner', bankAccount: 'bank', note: '' }],
    };

    expect(hasMeaningfulTrackerData(cashOnly)).toBe(true);
    expect(normalizeImportedTrackerState(cashOnly)).toBe(cashOnly);

    const key = findTrackerStorageKey(localStorage);
    localStorage.setItem(key, JSON.stringify(cashOnly));
    expect(getCurrentTrackerState(localStorage)).toMatchObject(cashOnly);
    localStorage.clear();
  });

  it('keeps cash-only local state when cloud is empty', () => {
    const merged = mergeLocalAndCloud(
      {
        cashAccounts: [{ id: 'cash-1' }],
        cashLedger: [{ id: 'led-1' }],
      },
      null,
    );

    expect(merged?.cashAccounts).toHaveLength(1);
    expect(merged?.cashLedger).toHaveLength(1);
  });
});
