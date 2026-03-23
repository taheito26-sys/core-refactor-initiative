import { describe, it, expect } from 'vitest';
import {
  getAllowedDealStatusTransitions,
  normalizeDealStatus,
  canTransitionDealStatus,
  assertDealStatusTransition,
} from '@/lib/merchant-deal-status';

describe('merchant-deal-status', () => {
  describe('normalizeDealStatus', () => {
    it('returns "approved" when status is "approved"', () => {
      expect(normalizeDealStatus('approved')).toBe('approved');
    });

    it('returns "rejected" when status is "rejected"', () => {
      expect(normalizeDealStatus('rejected')).toBe('rejected');
    });

    it('returns "cancelled" when status is "cancelled"', () => {
      expect(normalizeDealStatus('cancelled')).toBe('cancelled');
    });

    it('returns "pending" for any other string', () => {
      expect(normalizeDealStatus('draft')).toBe('pending');
      expect(normalizeDealStatus('active')).toBe('pending');
      expect(normalizeDealStatus('something')).toBe('pending');
    });

    it('returns "pending" for null/undefined', () => {
      expect(normalizeDealStatus(null)).toBe('pending');
      expect(normalizeDealStatus(undefined)).toBe('pending');
    });
  });

  describe('getAllowedDealStatusTransitions', () => {
    it('pending → [approved, rejected, cancelled]', () => {
      expect(getAllowedDealStatusTransitions('pending')).toEqual(['approved', 'rejected', 'cancelled']);
    });

    it('approved → [cancelled]', () => {
      expect(getAllowedDealStatusTransitions('approved')).toEqual(['cancelled']);
    });

    it('rejected → [] (terminal)', () => {
      expect(getAllowedDealStatusTransitions('rejected')).toEqual([]);
    });

    it('cancelled → [] (terminal)', () => {
      expect(getAllowedDealStatusTransitions('cancelled')).toEqual([]);
    });
  });

  describe('canTransitionDealStatus', () => {
    it('pending → approved is VALID', () => {
      expect(canTransitionDealStatus('pending', 'approved')).toBe(true);
    });

    it('pending → rejected is VALID', () => {
      expect(canTransitionDealStatus('pending', 'rejected')).toBe(true);
    });

    it('pending → cancelled is VALID', () => {
      expect(canTransitionDealStatus('pending', 'cancelled')).toBe(true);
    });

    it('pending → pending (idempotent) is VALID', () => {
      expect(canTransitionDealStatus('pending', 'pending')).toBe(true);
    });

    it('approved → pending is INVALID', () => {
      expect(canTransitionDealStatus('approved', 'pending')).toBe(false);
    });

    it('approved → cancelled is VALID', () => {
      expect(canTransitionDealStatus('approved', 'cancelled')).toBe(true);
    });

    it('approved → approved (idempotent) is VALID', () => {
      expect(canTransitionDealStatus('approved', 'approved')).toBe(true);
    });

    it('rejected → approved is INVALID', () => {
      expect(canTransitionDealStatus('rejected', 'approved')).toBe(false);
    });

    it('cancelled → approved is INVALID', () => {
      expect(canTransitionDealStatus('cancelled', 'approved')).toBe(false);
    });
  });

  describe('assertDealStatusTransition', () => {
    it('pending → approved does not throw', () => {
      expect(() => assertDealStatusTransition('pending', 'approved')).not.toThrow();
    });

    it('approved → pending throws with correct message', () => {
      expect(() => assertDealStatusTransition('approved', 'pending')).toThrow(
        'Illegal merchant deal status transition: approved -> pending'
      );
    });

    it('rejected → approved throws', () => {
      expect(() => assertDealStatusTransition('rejected', 'approved')).toThrow(
        'Illegal merchant deal status transition: rejected -> approved'
      );
    });

    it('idempotent transitions do not throw', () => {
      expect(() => assertDealStatusTransition('pending', 'pending')).not.toThrow();
      expect(() => assertDealStatusTransition('approved', 'approved')).not.toThrow();
      expect(() => assertDealStatusTransition('rejected', 'rejected')).not.toThrow();
      expect(() => assertDealStatusTransition('cancelled', 'cancelled')).not.toThrow();
    });
  });
});
