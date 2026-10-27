import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/lib/theme/types';
import { inRange } from '@/lib/tracker-helpers';
import { useOrderDateFilters } from './useOrderDateFilters';

function useHarness(initial: AppSettings['range']) {
  const [range, setRange] = useState(initial);
  const filters = useOrderDateFilters(range, patch => setRange(patch.range), '2026-10');
  const timestamps = [new Date(2026, 8, 15).getTime(), new Date(2026, 9, 26).getTime()];
  const visible = timestamps.filter(ts => {
    if (!inRange(ts, filters.dayFilter ? 'all' : range)) return false;
    const d = new Date(ts);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return filters.selectedMonth === 'all' || month === filters.selectedMonth;
  });
  return { ...filters, range, setRange, visible };
}

afterEach(() => vi.useRealTimers());

describe('Orders date selection', () => {
  it.each(['today', '7d', '30d', 'this_month'] as const)('loads September in one selection from %s', initial => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 12));
    const { result } = renderHook(() => useHarness(initial));
    expect(result.current.visible).not.toContain(new Date(2026, 8, 15).getTime());
    act(() => result.current.selectMonth('2026-09'));
    expect(result.current.range).toBe('all');
    expect(result.current.selectedMonth).toBe('2026-09');
    expect(result.current.visible).toEqual([new Date(2026, 8, 15).getTime()]);
  });

  it('clears a conflicting day period when another month is selected', () => {
    const { result } = renderHook(() => useHarness('all'));
    act(() => { result.current.setDayFilter('2026-10-01'); result.current.setDayFilterTo('2026-10-20'); });
    act(() => result.current.selectMonth('2026-09'));
    expect(result.current.dayFilter).toBe('');
    expect(result.current.dayFilterTo).toBe('');
  });

  it('lets a subsequent header range replace the month and restores all months on demand', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 12));
    const { result } = renderHook(() => useHarness('this_month'));
    act(() => result.current.selectMonth('2026-09'));
    act(() => result.current.setRange('7d'));
    expect(result.current.selectedMonth).toBe('all');
    expect(result.current.visible).toEqual([new Date(2026, 9, 26).getTime()]);
    act(() => result.current.selectMonth('all'));
    expect(result.current.range).toBe('all');
    expect(result.current.visible).toHaveLength(2);
  });
});
