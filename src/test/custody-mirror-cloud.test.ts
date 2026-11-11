import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: { cash_accounts: Record<string, unknown>[]; cash_ledger: Record<string, unknown>[] } = { cash_accounts: [], cash_ledger: [] };
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: 'cash_accounts' | 'cash_ledger') => ({ select: () => ({ in: async () => ({ data: rows[table], error: null }) }) }),
  },
}));
const upsert = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/cash-sync', async (orig) => ({ ...(await orig<typeof import('@/lib/cash-sync')>()), upsertLedgerEntriesToCloud: (e: unknown) => upsert(e) }));

import { applyCustodyMirrorToCloud } from '@/features/cash/custody-mirror-cloud';
import type { CustodyMirrorStatus } from '@/features/cash/custody-mirror';

const link = encodeURIComponent(JSON.stringify({ merchantId: 'zakaria', relationshipId: 'rel-1', purpose: 'custody' }));
const status = (over: Partial<CustodyMirrorStatus> = {}): CustodyMirrorStatus => ({
  account_id: 'xa71zn1l', role: 'mirror', source_account_id: '4pbytt1j', source_balance: 85500, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  rows.cash_accounts = [{ id: 'xa71zn1l', name: 'Custody — zakaria', type: 'vault', currency: 'QAR', status: 'active', is_merchant_account: true, notes: `[[custody-link:${link}]]`, created_at: 1 }];
  rows.cash_ledger = [{ id: 'l1', account_id: 'xa71zn1l', ts: 1, type: 'transfer_out', direction: 'out', amount: '10500', currency: 'QAR', note: 'Custody request to zakaria' }];
});

describe('applyCustodyMirrorToCloud', () => {
  it("writes the entry that takes the mirror account from −10,500 to the holder's 85,500", async () => {
    expect(await applyCustodyMirrorToCloud([status()])).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toEqual([expect.objectContaining({ accountId: 'xa71zn1l', direction: 'in', amount: 96000, merchantId: 'zakaria', relationshipId: 'rel-1' })]);
  });

  it('writes nothing once the account already matches', async () => {
    rows.cash_ledger.push({ id: 'cmirror-x', account_id: 'xa71zn1l', ts: 2, type: 'reconcile', direction: 'in', amount: '96000', currency: 'QAR', note: 'sync' });
    expect(await applyCustodyMirrorToCloud([status()])).toBe(0);
    expect(upsert).toHaveBeenCalledWith([]);
  });

  it('does not even read the cloud when there is no mirror account', async () => {
    expect(await applyCustodyMirrorToCloud([status({ role: 'holder' })])).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
