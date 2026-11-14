import { monthKey, lastMonths, tripSetStats, driverMonthStats, type MonthStats } from './driver-stats';
import { placeText } from './geo';
import type { TripData } from './api';
import type { Lang } from './route';
import type { ShipmentDriver } from './types';

/** Which trips a roster is measured over: one month (device local time) or everything. */
export type RosterPeriod = { kind: 'month'; month: string } | { kind: 'all' };

export type DriverStatus = 'on_the_road' | 'available' | 'off';
export type SetStats = ReturnType<typeof tripSetStats>;

export interface DriverSummary {
  driver: ShipmentDriver;
  status: DriverStatus;
  /** The trip the driver is on right now, if any. */
  current: TripData | null;
  /** Where that trip's truck was last seen, named, and when. */
  currentPlace: string | null;
  lastSeenAt: string | null;
  stats: SetStats;
  /** The last six months, oldest first, for the driver's detail. */
  months: MonthStats[];
  /** The driver's trips in the period, newest first. */
  trips: TripData[];
}

export const tripsInPeriod = (trips: TripData[], period: RosterPeriod): TripData[] =>
  period.kind === 'all' ? trips : trips.filter((t) => t.started_at && monthKey(t.started_at) === period.month);

const newestLocation = (t: TripData) =>
  [...t.locations].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0] ?? null;

/** Each driver with their status and numbers for the period, drivers on the road first, then by trips driven. */
export function driverSummaries(drivers: ShipmentDriver[], trips: TripData[], period: RosterPeriod, now: number, lang: Lang): DriverSummary[] {
  const months = lastMonths(6, now);
  const out = drivers.map((driver): DriverSummary => {
    const mine = trips.filter((t) => t.driver_id === driver.id);
    const current = mine.filter((t) => t.status === 'on_the_road').sort((a, b) => new Date(b.started_at ?? b.created_at).getTime() - new Date(a.started_at ?? a.created_at).getTime())[0] ?? null;
    const where = current ? newestLocation(current) : null;
    const inPeriod = tripsInPeriod(mine, period);
    return {
      driver,
      status: !driver.active ? 'off' : current ? 'on_the_road' : 'available',
      current,
      currentPlace: where ? placeText(where, lang) : null,
      lastSeenAt: where?.recorded_at ?? null,
      stats: tripSetStats(inPeriod, now),
      months: months.map((m) => driverMonthStats(mine, m, now)),
      trips: [...inPeriod].sort((a, b) => new Date(b.started_at ?? b.created_at).getTime() - new Date(a.started_at ?? a.created_at).getTime()),
    };
  });
  const rank: Record<DriverStatus, number> = { on_the_road: 0, available: 1, off: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.stats.tripsStarted - a.stats.tripsStarted || a.driver.display_name.localeCompare(b.driver.display_name));
}

export interface TeamTotals {
  drivers: number;
  onTheRoad: number;
  stats: SetStats;
}

/** The whole team in one line: how many drivers, how many on the road, and the period's numbers across all of them. */
export function teamTotals(drivers: ShipmentDriver[], summaries: DriverSummary[], trips: TripData[], period: RosterPeriod, now: number): TeamTotals {
  const ids = new Set(drivers.map((d) => d.id));
  return {
    drivers: drivers.length,
    onTheRoad: summaries.filter((s) => s.status === 'on_the_road').length,
    stats: tripSetStats(tripsInPeriod(trips.filter((t) => t.driver_id && ids.has(t.driver_id)), period), now),
  };
}
