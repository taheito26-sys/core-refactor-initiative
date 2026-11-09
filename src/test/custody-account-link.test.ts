import { describe, expect, it } from 'vitest';
import { encodeCustodyAccountNotes, decodeCustodyAccountNotes, resolveCustodyAccountRecipient } from '@/features/cash/custody-account-link';
import type { CashAccount } from '@/lib/tracker-helpers';
const account: CashAccount = { id: 'existing', name: 'Custody — zakaria', type: 'merchant_custody', currency: 'QAR', status: 'active', createdAt: 1 };
const cp = { relationshipId: 'rel-1', counterpartyMerchantId: 'zack', counterpartyUserId: 'user-zack', counterpartyLabel: 'zakaria', status: 'active' };
describe('custody account identity', () => {
  it('round-trips recipient links and human notes using the existing cloud notes field', () => {
    const linked = { ...account, merchantId: cp.counterpartyMerchantId, relationshipId: cp.relationshipId, purpose: 'custody' as const, notes: 'Cash held • عهدة' };
    const encoded = encodeCustodyAccountNotes(linked);
    expect(decodeCustodyAccountNotes(encoded)).toEqual({ notes: linked.notes, link: { merchantId: 'zack', relationshipId: 'rel-1', purpose: 'custody' } });
    expect(resolveCustodyAccountRecipient({ ...account, ...decodeCustodyAccountNotes(encoded).link }, [cp])).toEqual(cp);
  });
  it('recovers a legacy generated account label only from a unique approved relationship', () => {
    expect(resolveCustodyAccountRecipient(account, [cp])).toEqual(cp);
    expect(resolveCustodyAccountRecipient(account, [cp, { ...cp, counterpartyMerchantId: 'another', counterpartyUserId: 'another-user' }])).toBeUndefined();
    expect(resolveCustodyAccountRecipient(account, [{ ...cp, status: 'pending' }])).toBeUndefined();
  });
  it('never overrides a known recipient or uses approximate names', () => {
    expect(resolveCustodyAccountRecipient({ ...account, merchantId: 'other' }, [cp])).toBeUndefined();
    expect(resolveCustodyAccountRecipient({ ...account, name: 'Custody — zakar' }, [cp])).toBeUndefined();
  });
  it('leaves ordinary notes and malformed metadata intact', () => {
    expect(encodeCustodyAccountNotes({ ...account, type: 'bank', notes: 'Bank note' })).toBe('Bank note');
    expect(decodeCustodyAccountNotes('note [[custody-link:bad]]')).toEqual({ notes: 'note [[custody-link:bad]]', link: {} });
    expect(decodeCustodyAccountNotes('note [[custody-link:null]]')).toEqual({ notes: 'note [[custody-link:null]]', link: {} });
  });
});
