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
    it('pending → [approved]', () => {
      expect(getAllowedDealStatusTransitions('pending')).toEqual(['approved']);
    });

    it('approved → []', () => {
      expect(getAllowedDealStatusTransitions('approved')).toEqual([]);
    });
  });

  describe('canTransitionDealStatus', () => {
    it('pending → approved is VALID', () => {
      expect(canTransitionDealStatus('pending', 'approved')).toBe(true);
    });

    it('pending → pending (idempotent) is VALID', () => {
      expect(canTransitionDealStatus('pending', 'pending')).toBe(true);
    });

    it('approved → pending is INVALID', () => {
      expect(canTransitionDealStatus('approved', 'pending')).toBe(false);
    });

    it('approved → approved (idempotent) is VALID', () => {
      expect(canTransitionDealStatus('approved', 'approved')).toBe(true);
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

    it('idempotent transitions do not throw', () => {
      expect(() => assertDealStatusTransition('pending', 'pending')).not.toThrow();
      expect(() => assertDealStatusTransition('approved', 'approved')).not.toThrow();
    });
  });
});
