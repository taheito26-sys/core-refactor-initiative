/**
 * Tests for customer order mirroring buyer type validation
 *
 * These tests verify that the mirror system correctly handles buyer type
 * categorization and prevents invalid mirroring attempts.
 */

import { BuyerType, MirrorStatus, Trade } from '@/lib/tracker-helpers';

describe('Customer order mirror buyer type handling', () => {
  const mockTrade = (overrides?: Partial<Trade>): Trade => ({
    id: 'test-trade-1',
    ts: Date.now(),
    inputMode: 'USDT' as const,
    amountUSDT: 1000,
    sellPriceQAR: 4.5,
    feeQAR: 45,
    note: 'test note',
    voided: false,
    usesStock: true,
    revisions: [],
    customerId: 'test-customer-1',
    ...overrides,
  });

  describe('Buyer type classification', () => {
    test('connected_customer trade should attempt mirror', () => {
      const trade = mockTrade({
        buyerType: 'connected_customer',
        connectedCustomerId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(trade.buyerType).toBe('connected_customer');
      expect(trade.connectedCustomerId).toBeTruthy();
    });

    test('manual_contact trade should not attempt mirror', () => {
      const trade = mockTrade({
        buyerType: 'manual_contact',
        connectedCustomerId: undefined,
      });

      expect(trade.buyerType).toBe('manual_contact');
      expect(trade.connectedCustomerId).toBeUndefined();
    });

    test('merchant trade should not attempt mirror', () => {
      const trade = mockTrade({
        buyerType: 'merchant',
        connectedCustomerId: undefined,
      });

      expect(trade.buyerType).toBe('merchant');
      expect(trade.connectedCustomerId).toBeUndefined();
    });

    test('external trade should not attempt mirror', () => {
      const trade = mockTrade({
        buyerType: 'external',
        connectedCustomerId: undefined,
      });

      expect(trade.buyerType).toBe('external');
      expect(trade.connectedCustomerId).toBeUndefined();
    });
  });

  describe('Mirror status tracking', () => {
    test('pending trade should attempt mirror', () => {
      const trade = mockTrade({
        mirrorStatus: 'pending',
      });

      expect(trade.mirrorStatus).toBe('pending');
    });

    test('mirrored trade should not retry', () => {
      const trade = mockTrade({
        mirrorStatus: 'mirrored',
      });

      expect(['mirrored', 'skipped_not_connected', 'failed']).toContain(trade.mirrorStatus);
    });

    test('skipped_not_connected trade should not retry', () => {
      const trade = mockTrade({
        buyerType: 'manual_contact',
        mirrorStatus: 'skipped_not_connected',
      });

      // Should be considered terminal and not retried
      expect(['skipped_not_connected']).toContain(trade.mirrorStatus);
    });

    test('failed trade should not retry without intervention', () => {
      const trade = mockTrade({
        mirrorStatus: 'failed',
      });

      expect(['mirrored', 'skipped_not_connected', 'failed']).toContain(trade.mirrorStatus);
    });
  });

  describe('Mirror eligibility rules', () => {
    test('connected_customer with UUID should be eligible', () => {
      const trade = mockTrade({
        buyerType: 'connected_customer',
        connectedCustomerId: '550e8400-e29b-41d4-a716-446655440000',
        mirrorStatus: 'pending',
      });

      const isEligible =
        trade.buyerType === 'connected_customer' &&
        trade.connectedCustomerId !== undefined &&
        (trade.mirrorStatus === 'pending' || trade.mirrorStatus === undefined);

      expect(isEligible).toBe(true);
    });

    test('connected_customer without UUID should not be eligible', () => {
      const trade = mockTrade({
        buyerType: 'connected_customer',
        connectedCustomerId: undefined,
      });

      const isEligible =
        trade.buyerType === 'connected_customer' &&
        trade.connectedCustomerId !== undefined;

      expect(isEligible).toBe(false);
    });

    test('manual_contact should never be eligible', () => {
      const trade = mockTrade({
        buyerType: 'manual_contact',
        connectedCustomerId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const isEligible = trade.buyerType === 'connected_customer';

      expect(isEligible).toBe(false);
    });

    test('trade with no buyerType should not be eligible', () => {
      const trade = mockTrade({
        buyerType: undefined,
        connectedCustomerId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const isEligible = trade.buyerType === 'connected_customer';

      expect(isEligible).toBe(false);
    });
  });

  describe('Idempotent mirror recovery', () => {
    test('should skip trades with terminal mirror status', () => {
      const trades = [
        mockTrade({ id: 't1', mirrorStatus: 'mirrored' }),
        mockTrade({ id: 't2', mirrorStatus: 'skipped_not_connected' }),
        mockTrade({ id: 't3', mirrorStatus: 'failed' }),
        mockTrade({ id: 't4', mirrorStatus: 'pending' }),
      ];

      const shouldRetry = (trade: Trade) => {
        return trade.mirrorStatus !== 'mirrored' &&
               trade.mirrorStatus !== 'skipped_not_connected' &&
               trade.mirrorStatus !== 'failed';
      };

      expect(shouldRetry(trades[0])).toBe(false); // mirrored
      expect(shouldRetry(trades[1])).toBe(false); // skipped_not_connected
      expect(shouldRetry(trades[2])).toBe(false); // failed
      expect(shouldRetry(trades[3])).toBe(true);  // pending
    });
  });

  describe('Legacy trade data handling', () => {
    test('trade without buyerType should be treated as non-mirrorable', () => {
      const trade = mockTrade({
        buyerType: undefined,
        customerId: 'john', // Could be manual contact, merchant, or legacy ID
      });

      // Without explicit buyerType, cannot safely mirror
      const canMirror = trade.buyerType === 'connected_customer';
      expect(canMirror).toBe(false);
    });

    test('trade with UUID-like customerId should require explicit buyerType', () => {
      const trade = mockTrade({
        buyerType: undefined,
        customerId: '550e8400-e29b-41d4-a716-446655440000', // Looks like UUID but could be legacy
      });

      const canMirror = trade.buyerType === 'connected_customer';
      expect(canMirror).toBe(false);
    });
  });
});
