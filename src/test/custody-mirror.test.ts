import { describe, expect, it } from 'vitest';
import { planCustodyMirror, type CustodyMirrorStatus } from '@/features/cash/custody-mirror';
import type { CashAccount, CashLedgerEntry } from '@/lib/tracker-helpers';

const account = (over: Partial<CashAccount> = {}): CashAccount => ({
  id: 'xa71zn1l', name: 'Custody — zakaria', type: 'merchant_custody', currency: 'QAR', status: 'active',
  merchantId: 'zakaria', relationshipId: 'rel-1', isMerchantAccount: true, createdAt: 1, ...over,
} as CashAccount);

const entry = (over: Partial<CashLedgerEntry>): CashLedgerEntry => ({
  id: 'e1', ts: 1, type: 'transfer_out', accountId: 'xa71zn1l', direction: 'out', amount: 10500, currency: 'QAR', ...over,
} as CashLedgerEntry);

const status = (over: Partial<CustodyMirrorStatus> = {}): CustodyMirrorStatus => ({
  account_id: 'xa71zn1l', role: 'mirror', source_account_id: '4pbytt1j', source_balance: 85500, ...over,
});

describe('planCustodyMirror', () => {
  it("brings a mirror account up to the holder's balance (−10,500 → 85,500)", () => {
    const plan = planCustodyMirror([account()], [entry({})], [status()], 1000);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ accountId: 'xa71zn1l', direction: 'in', amount: 96000, type: 'merchant_adjustment', merchantId: 'zakaria', relationshipId: 'rel-1' });
  });

  it('adjusts downwards when the holder withdraws', () => {
    const plan = planCustodyMirror([account()], [entry({ direction: 'in', amount: 85500 })], [status({ source_balance: '80000' })], 1);
    expect(plan[0]).toMatchObject({ direction: 'out', amount: 5500 });
  });

  it('plans nothing when the balances already match, so applying the plan converges', () => {
    const first = planCustodyMirror([account()], [entry({})], [status()], 1);
    expect(planCustodyMirror([account()], [entry({}), ...first], [status()], 2)).toEqual([]);
  });

  it('gives two devices planning from the same state the same entry id', () => {
    const a = planCustodyMirror([account()], [entry({})], [status()], 1);
    const b = planCustodyMirror([account()], [entry({})], [status()], 999);
    expect(a[0].id).toBe(b[0].id);
  });

  it('never touches a holder account, an unknown account or an inactive one', () => {
    expect(planCustodyMirror([account()], [], [status({ role: 'holder' })], 1)).toEqual([]);
    expect(planCustodyMirror([account()], [], [status({ account_id: 'nope' })], 1)).toEqual([]);
    expect(planCustodyMirror([account({ status: 'inactive' })], [], [status()], 1)).toEqual([]);
    expect(planCustodyMirror([account({ type: 'bank' })], [], [status()], 1)).toEqual([]);
  });

  it('ignores a non-numeric balance', () => {
    expect(planCustodyMirror([account()], [], [status({ source_balance: 'NaN' })], 1)).toEqual([]);
  });
});
