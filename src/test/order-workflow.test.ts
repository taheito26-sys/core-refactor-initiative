import { describe, it, expect } from 'vitest';
import { buildOrderFromDraft, createId, economicTermsChanged, getMerchantAgreementDeleteMode, createMerchantAgreementSnapshot } from '@/lib/trading/utils';
import { calculateNetProfit } from '@/lib/trading/profit-service';
import type { MerchantAgreement, OrderDraft, AgreementTemplate } from '@/lib/trading/types';

describe('trading/profit-service — calculateNetProfit', () => {
  const base = { templateId: 'T1', agreementId: 'A1', version: 1 };

  it('profit_share: round(total * profitSharePercent / 100)', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: { ...base, agreementType: 'profit_share', profitSharePercent: 20 },
    });
    expect(result).toBe(200);
  });

  it('fixed_margin: round(quantity * fixedMarginAmount)', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: { ...base, agreementType: 'fixed_margin', fixedMarginAmount: 2 },
    });
    expect(result).toBe(200);
  });

  it('spread: round(total * spreadPercent / 100)', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: { ...base, agreementType: 'spread', spreadPercent: 1.5 },
    });
    expect(result).toBe(15);
  });

  it('commission: round(total * commissionPercent / 100)', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: { ...base, agreementType: 'commission', commissionPercent: 5 },
    });
    expect(result).toBe(50);
  });

  it('custom: round(sum(fixedValues) + total * sum(percentages) / 100)', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: {
        ...base, agreementType: 'custom',
        fixedValues: { base: 10 },
        percentages: { fee: 2 },
      },
    });
    expect(result).toBe(30);
  });

  it('unknown type returns 0', () => {
    const result = calculateNetProfit({
      quantity: 100, unitPrice: 10,
      snapshot: { ...base, agreementType: 'unknown' as any },
    });
    expect(result).toBe(0);
  });
});

describe('trading/utils', () => {
  describe('createId', () => {
    it('returns prefixed ID', () => {
      const id = createId('ORD');
      expect(id).toMatch(/^ORD-[a-z0-9]+$/);
    });
  });

  describe('economicTermsChanged', () => {
    it('returns false for identical configs', () => {
      const cfg = { profitSharePercent: 20 };
      expect(economicTermsChanged(cfg, { ...cfg })).toBe(false);
    });

    it('returns true for different configs', () => {
      expect(economicTermsChanged({ profitSharePercent: 20 }, { profitSharePercent: 30 })).toBe(true);
    });
  });

  describe('getMerchantAgreementDeleteMode', () => {
    const agreement = { id: 'agr-1' } as MerchantAgreement;

    it('returns "archive" if agreement is used in orders', () => {
      expect(getMerchantAgreementDeleteMode(agreement, new Set(['agr-1']))).toBe('archive');
    });

    it('returns "delete" if agreement is unused', () => {
      expect(getMerchantAgreementDeleteMode(agreement, new Set())).toBe('delete');
    });
  });

  describe('buildOrderFromDraft', () => {
    const mockAgreement: MerchantAgreement = {
      id: 'agr-1',
      templateId: 'tpl-1',
      merchantId: 'MRC-001',
      merchantName: 'Test Merchant',
      agreementType: 'profit_share',
      title: 'Test Agreement',
      status: 'approved',
      approvedByUserId: 'user-1',
      approvedAt: '2026-01-01T00:00:00Z',
      resolvedTermsSnapshot: {
        templateId: 'tpl-1',
        agreementId: 'agr-1',
        version: 1,
        agreementType: 'profit_share',
        profitSharePercent: 20,
      },
      version: 1,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const mockDraft: OrderDraft = {
      direction: 'outgoing',
      merchantId: 'MRC-001',
      merchantName: 'Test Merchant',
      buyerId: 'BUY-001',
      buyerName: 'Test Buyer',
      merchantAgreementId: 'agr-1',
      quantity: 100,
      unitPrice: 10,
      currency: 'USDT',
    };

    it('creates order with correct computedNetProfit for profit_share', () => {
      const order = buildOrderFromDraft(mockDraft, mockAgreement, 'user-1');
      expect(order.computedNetProfit).toBe(200); // 1000 * 20%
      expect(order.totalAmount).toBe(1000);
      expect(order.status).toBe('confirmed');
      expect(order.agreementSnapshot.profitSharePercent).toBe(20);
    });

    it('throws when agreement is not approved', () => {
      const pendingAgreement = { ...mockAgreement, status: 'pending' as const };
      expect(() => buildOrderFromDraft(mockDraft, pendingAgreement, 'user-1'))
        .toThrow('Agreement must be approved and active');
    });

    it('throws when agreement is not active', () => {
      const inactiveAgreement = { ...mockAgreement, isActive: false };
      expect(() => buildOrderFromDraft(mockDraft, inactiveAgreement, 'user-1'))
        .toThrow('Agreement must be approved and active');
    });

    it('throws when merchantId does not match', () => {
      const mismatchDraft = { ...mockDraft, merchantId: 'MRC-999' };
      expect(() => buildOrderFromDraft(mismatchDraft, mockAgreement, 'user-1'))
        .toThrow('agreement.merchantId must equal draft.merchantId');
    });

    it('preserves immutable agreementSnapshot', () => {
      const order = buildOrderFromDraft(mockDraft, mockAgreement, 'user-1');
      // Snapshot should be a copy, not a reference
      expect(order.agreementSnapshot).not.toBe(mockAgreement.resolvedTermsSnapshot);
      expect(order.agreementSnapshot).toEqual(mockAgreement.resolvedTermsSnapshot);
    });
  });
});
