import { startOfWeek, endOfWeek, startOfMonth, endOfMonth,
         addWeeks, addMonths, isBefore, isAfter, format } from 'date-fns';

export type Cadence = 'per_order' | 'weekly' | 'monthly';
export type PeriodStatus = 'pending' | 'due' | 'overdue' | 'settled' | 'disputed';

export interface PeriodBounds {
  key: string;
  start: Date;
  end: Date;
  dueAt: Date;
  label: string;
}

/**
 * Generate all period boundaries from deal creation until now.
 * per_order periods are created on-demand when trades happen — returns empty.
 */
export function generatePeriods(
  cadence: Cadence,
  dealCreatedAt: string | Date,
  now: Date = new Date()
): PeriodBounds[] {
  const dealStart = new Date(dealCreatedAt);
  const periods: PeriodBounds[] = [];

  if (cadence === 'per_order') return [];

  if (cadence === 'weekly') {
    let weekStart = startOfWeek(dealStart, { weekStartsOn: 1 });
    while (isBefore(weekStart, now)) {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekNum = format(weekStart, 'yyyy') + '-W' + format(weekStart, 'II');
      const dueAt = new Date(weekEnd.getTime() + 86400000);
      periods.push({
        key: weekNum,
        start: weekStart,
        end: weekEnd,
        dueAt,
        label: `Week ${format(weekStart, 'II')} (${format(weekStart, 'MMM d')}–${format(weekEnd, 'MMM d')})`,
      });
      weekStart = addWeeks(weekStart, 1);
    }
    return periods;
  }

  if (cadence === 'monthly') {
    let monthStart = startOfMonth(dealStart);
    while (isBefore(monthStart, now)) {
      const monthEnd = endOfMonth(monthStart);
      const monthKey = format(monthStart, 'yyyy-MM');
      const dueAt = new Date(monthEnd.getTime() + 86400000);
      periods.push({
        key: monthKey,
        start: monthStart,
        end: monthEnd,
        dueAt,
        label: format(monthStart, 'MMMM yyyy'),
      });
      monthStart = addMonths(monthStart, 1);
    }
    return periods;
  }

  return periods;
}

/**
 * Determine period status based on time and settlement state.
 * Overdue = 7 days past due with no settlement.
 */
export function computePeriodStatus(
  periodEnd: Date,
  isSettled: boolean,
  now: Date = new Date()
): PeriodStatus {
  if (isSettled) return 'settled';
  const dueAt = new Date(periodEnd.getTime() + 86400000);
  if (isAfter(now, addWeeks(dueAt, 1))) return 'overdue';
  if (isAfter(now, periodEnd)) return 'due';
  return 'pending';
}

/**
 * Get the current active period for a cadence.
 */
export function getCurrentPeriod(cadence: Cadence, now: Date = new Date()): PeriodBounds | null {
  if (cadence === 'per_order') return null;

  if (cadence === 'weekly') {
    const start = startOfWeek(now, { weekStartsOn: 1 });
    const end = endOfWeek(now, { weekStartsOn: 1 });
    return {
      key: format(start, 'yyyy') + '-W' + format(start, 'II'),
      start, end,
      dueAt: new Date(end.getTime() + 86400000),
      label: `Week ${format(start, 'II')} (${format(start, 'MMM d')}–${format(end, 'MMM d')})`,
    };
  }

  if (cadence === 'monthly') {
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    return {
      key: format(start, 'yyyy-MM'),
      start, end,
      dueAt: new Date(end.getTime() + 86400000),
      label: format(start, 'MMMM yyyy'),
    };
  }

  return null;
}
