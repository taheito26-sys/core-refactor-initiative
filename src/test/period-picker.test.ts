import { describe, expect, it } from 'vitest';
import { orderedPeriod, periodFromMonths } from '@/components/shared/PeriodPicker';

describe('period picker', () => {
  it('turns a from month and a to month into the first and last day they cover', () => {
    expect(periodFromMonths('2026-08', '2026-10')).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(periodFromMonths('2026-02', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFromMonths('2024-02', '2024-02').to).toBe('2024-02-29');
  });

  it('does not mind which month was picked first', () => {
    expect(periodFromMonths('2026-10', '2026-08')).toEqual({ from: '2026-08-01', to: '2026-10-31' });
  });

  it('puts two days in order and treats equal ends as one day', () => {
    expect(orderedPeriod('2026-10-21', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-21' });
    expect(orderedPeriod('2026-10-05', '2026-10-05')).toEqual({ from: '2026-10-05', to: '' });
    expect(orderedPeriod('2026-10-05', '')).toEqual({ from: '2026-10-05', to: '' });
    expect(orderedPeriod('', '2026-10-05')).toEqual({ from: '', to: '' });
  });
});
