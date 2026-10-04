import { describe, expect, it } from 'vitest';
import { chainToFrozenOpening, closingDrift, previousMonthKey } from '@/features/net-position/snapshots';
import type { MonthBridge, MonthPosition } from '@/lib/trading/net-position';

const pos = (opening: number, closing: number) => ({ opening: { netQAR: opening }, closing: { netQAR: closing } }) as unknown as MonthPosition;
const bridge = (opening: number) => ({ openingQAR: opening, netRevenueQAR: 0, otherQAR: 0, closingQAR: 0 }) as unknown as MonthBridge;

describe('previousMonthKey', () => {
  it('steps back one month across a year boundary', () => {
    expect(previousMonthKey('2026-10')).toBe('2026-09');
    expect(previousMonthKey('2026-01')).toBe('2025-12');
  });
});

describe('closingDrift', () => {
  it('is zero when today\'s rebuild matches the frozen month, and shows the gap when a record was edited', () => {
    const frozen = { position: pos(100, 110) };
    expect(closingDrift(frozen, pos(100, 110.4))).toBe(0);
    expect(closingDrift(frozen, pos(100, 95))).toBe(-15);
  });
});

describe('chainToFrozenOpening', () => {
  it('leaves a month alone when the month before it is not frozen', () => {
    const live = { opening: 120, bridge: bridge(120) };
    expect(chainToFrozenOpening(live, undefined)).toEqual({ openingQAR: 120, priorCorrectionsQAR: 0, bridge: live.bridge });
    expect(chainToFrozenOpening(live, { frozen: false, position: pos(0, 100) }).openingQAR).toBe(120);
  });

  it('opens from the frozen closing and shows the difference as corrections to earlier months', () => {
    const r = chainToFrozenOpening({ opening: 120, bridge: bridge(120) }, { frozen: true, position: pos(100, 110) });
    expect(r.openingQAR).toBe(110);
    expect(r.priorCorrectionsQAR).toBe(10);
    expect(r.bridge.openingQAR).toBe(110);
    expect(r.bridge.priorCorrectionsQAR).toBe(10);
  });
});
