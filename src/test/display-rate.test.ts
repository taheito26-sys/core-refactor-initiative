import { describe, expect, it } from 'vitest';
import { displayQarEgpRate, isUpliftMonth } from '@/features/customer/display-rate';

describe('displayQarEgpRate', () => {
  it('adds 0.20 to a September 2026 order\'s rate and nothing else', () => {
    expect(displayQarEgpRate(13.5, new Date(2026, 8, 15).getTime())).toBe(13.7);
    expect(displayQarEgpRate(13.5, '2026-09-30T10:00:00')).toBe(13.7);
    expect(displayQarEgpRate(13.5, new Date(2026, 7, 31, 23, 59).getTime())).toBe(13.5);
    expect(displayQarEgpRate(13.5, new Date(2026, 9, 1).getTime())).toBe(13.5);
    expect(displayQarEgpRate(13.5, new Date(2025, 8, 15).getTime())).toBe(13.5);
  });
  it('ignores a missing or invalid date', () => {
    expect(isUpliftMonth(undefined)).toBe(false);
    expect(displayQarEgpRate(13.5, 'nope')).toBe(13.5);
  });
});
