import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { inRange } from '@/lib/tracker-helpers';
import { useDashboardNow } from '@/features/dashboard/hooks/useDashboardNow';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dashboard calendar rollover', () => {
  it('switches an open dashboard into November at local midnight without new orders', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 59, 500));
    const { result } = renderHook(useDashboardNow);
    expect(new Date(result.current).getMonth()).toBe(9);
    act(() => { vi.advanceTimersByTime(501); });
    expect(result.current).toBe(new Date(2026, 10, 1, 0, 0).getTime());
    expect(inRange(new Date(2026, 9, 31, 12).getTime(), 'this_month', result.current)).toBe(false);
    expect(inRange(result.current, 'this_month', result.current)).toBe(true);
  });
  it('catches up immediately when a suspended dashboard receives focus', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 12));
    const { result } = renderHook(useDashboardNow);
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toBe(new Date(2026, 10, 1, 12).getTime());
  });
});
