import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@/lib/theme/types';

type Range = AppSettings['range'];

export function useOrderDateFilters(range: Range, update: (patch: Partial<AppSettings>) => void, currentMonth: string) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [dayFilter, setDayFilter] = useState('');
  const [dayFilterTo, setDayFilterTo] = useState('');
  const previousRange = useRef(range);

  useEffect(() => {
    if (previousRange.current === range) return;
    previousRange.current = range;
    setSelectedMonth('all');
    setDayFilter('');
    setDayFilterTo('');
  }, [range, currentMonth]);

  const selectMonth = useCallback((month: string) => {
    setSelectedMonth(month);
    setDayFilter('');
    setDayFilterTo('');
    // The month supplies the date boundary; the global range must not exclude it.
    previousRange.current = 'all';
    if (range !== 'all') update({ range: 'all' });
  }, [range, update]);

  return { selectedMonth, selectMonth, dayFilter, setDayFilter, dayFilterTo, setDayFilterTo };
}
