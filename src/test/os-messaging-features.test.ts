import { describe, it, expect } from 'vitest';
import { computeTrustScore, isMessageVisibleInSearch, shouldSuppressUnreadIncrement } from '@/lib/os-feature-utils';

describe('Antigravity Messaging OS acceptance helpers', () => {
  it('computes trust score with visible factors', () => {
    const trust = computeTrustScore({
      responseSpeed: 80,
      completionRate: 90,
      disputeRate: 10,
      verificationScore: 100,
    });

    expect(trust.score).toBeGreaterThan(0);
    expect(trust.factors).toHaveLength(4);
    expect(trust.factors.map((f) => f.name)).toEqual([
      'response_speed',
      'completion_rate',
      'dispute_rate',
      'verification_status',
    ]);
  });

  it('hides expired unpinned messages from search', () => {
    const now = new Date('2026-03-26T20:00:00.000Z');
    const visible = isMessageVisibleInSearch({
      expiresAt: '2026-03-26T19:59:59.000Z',
      isPinned: false,
      legalHold: false,
      now,
    });

    expect(visible).toBe(false);
  });

  it('keeps legal-hold message searchable for compliance', () => {
    const now = new Date('2026-03-26T20:00:00.000Z');
    const visible = isMessageVisibleInSearch({
      expiresAt: '2026-03-26T19:59:59.000Z',
      isPinned: false,
      legalHold: true,
      now,
    });

    expect(visible).toBe(true);
  });

  it('suppresses unread increments while user is actively reading room', () => {
    expect(
      shouldSuppressUnreadIncrement({ appFocused: true, roomFocused: true, inTargetRoom: true }),
    ).toBe(true);

    expect(
      shouldSuppressUnreadIncrement({ appFocused: false, roomFocused: true, inTargetRoom: true }),
    ).toBe(false);
  });
});
