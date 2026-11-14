import { describe, expect, it } from 'vitest';
import {
  driverMonthStats, durationHoursLabel, gradeOf, lastMonths, monthKey, routeDistanceKm, tripPunctuality, type TripLike,
} from '@/features/shipments/driver-stats';

const H = 3_600_000;
// Mid-month at midday so the device's time zone cannot move a date into the next month.
const T0 = new Date(2026, 10, 10, 12, 0, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const trip = (over: Partial<TripLike> = {}): TripLike => ({
  status: 'delivered', started_at: iso(T0), delivered_at: iso(T0 + 50 * H), weight_tons: 18.4, reading_interval_hours: 3,
  stops: [{ reached_at: iso(T0) }, { reached_at: iso(T0 + 10 * H) }, { reached_at: iso(T0 + 50 * H) }],
  readings: [], locations: [], ...over,
});
const reading = (hoursIn: number, alert = false) => ({ taken_at: iso(T0 + hoursIn * H), is_alert: alert });

describe('months', () => {
  it('names a month and lists the last few, oldest first', () => {
    expect(monthKey(new Date(2026, 10, 14))).toBe('2026-11');
    expect(lastMonths(4, new Date(2026, 1, 20).getTime())).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('routeDistanceKm', () => {
  const p = (lat: number, lon: number, hours: number) => ({ latitude: lat, longitude: lon, recorded_at: iso(T0 + hours * H) });
  it('adds up the legs in time order, whatever order the points arrive in', () => {
    const km = routeDistanceKm([p(30.0, 31.2, 0), p(31.0, 31.2, 1), p(32.0, 31.2, 2)].reverse());
    expect(km).toBeGreaterThan(215);
    expect(km).toBeLessThan(225);
  });
  it('ignores an impossible jump (a GPS glitch) but keeps the rest', () => {
    const km = routeDistanceKm([p(30.0, 31.2, 0), p(31.0, 31.2, 1), p(60.0, 31.2, 1.1), p(31.5, 31.2, 2)]);
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(180);
  });
  it('is zero with fewer than two points', () => {
    expect(routeDistanceKm([])).toBe(0);
    expect(routeDistanceKm([p(1, 1, 0)])).toBe(0);
  });
});

describe('tripPunctuality', () => {
  it('counts readings within the interval plus grace as on time', () => {
    const t = trip({ delivered_at: iso(T0 + 8 * H), readings: [reading(2.5), reading(5.4), reading(8)] });
    expect(tripPunctuality(t, T0 + 100 * H)).toEqual({ onTime: 3, late: 0, missed: 0 });
  });
  it('counts a long silence as late, and the readings that should have come as missed', () => {
    const t = trip({ delivered_at: iso(T0 + 12 * H), readings: [reading(2), reading(9)] });   // 7 h gap
    expect(tripPunctuality(t, T0 + 100 * H)).toEqual({ onTime: 1, late: 1, missed: 2 });
  });
  it('counts the tail after the last reading, and measures an unfinished trip up to now', () => {
    const t = trip({ status: 'on_the_road', delivered_at: null, readings: [reading(2)] });
    expect(tripPunctuality(t, T0 + 9 * H)).toEqual({ onTime: 1, late: 0, missed: 2 });
  });
  it('ignores readings taken before the trip started', () => {
    const t = trip({ delivered_at: iso(T0 + 3 * H), readings: [reading(-5), reading(2)] });
    expect(tripPunctuality(t, T0 + 100 * H)).toEqual({ onTime: 1, late: 0, missed: 0 });
  });
  it('has nothing to measure before a trip starts', () => {
    expect(tripPunctuality(trip({ started_at: null }), T0)).toEqual({ onTime: 0, late: 0, missed: 0 });
  });
});

describe('driverMonthStats', () => {
  const now = T0 + 200 * H;
  const month = monthKey(T0);

  it('adds a month up: trips, tons, duration, compliance, punctuality and stops', () => {
    const a = trip({ readings: [reading(2), reading(5), reading(8, true), reading(11), reading(14)], delivered_at: iso(T0 + 14 * H) });
    const b = trip({ weight_tons: 10, started_at: iso(T0 + 100 * H), delivered_at: iso(T0 + 120 * H), readings: [{ taken_at: iso(T0 + 102 * H), is_alert: false }] });
    const s = driverMonthStats([a, b], month, now);
    expect(s.tripsStarted).toBe(2);
    expect(s.tripsDelivered).toBe(2);
    expect(s.tons).toBe(28.4);
    expect(s.avgTripHours).toBe(17);
    expect(s.readings).toBe(6);
    expect(s.alerts).toBe(1);
    expect(s.inRangePct).toBe(83.3);
    expect(s.stopsConfirmed).toBe(4);
    expect(s.missedReadings).toBeGreaterThan(0);
    expect(s.onTimePct).not.toBeNull();
  });

  it('counts a trip in the month it started, leaves out cancelled trips, and keeps other months apart', () => {
    const nextMonth = trip({ started_at: iso(new Date(2026, 11, 10, 12).getTime()), delivered_at: iso(new Date(2026, 11, 11, 12).getTime()) });
    const cancelled = trip({ status: 'cancelled' });
    const s = driverMonthStats([trip(), nextMonth, cancelled], month, now);
    expect(s.tripsStarted).toBe(1);
  });

  it('only counts tons for delivered trips', () => {
    const onRoad = trip({ status: 'on_the_road', delivered_at: null });
    expect(driverMonthStats([onRoad], month, now).tons).toBe(0);
    expect(driverMonthStats([onRoad], month, now).tripsStarted).toBe(1);
  });

  it('reports no percentages for an empty month rather than 0 or 100', () => {
    const s = driverMonthStats([], month, now);
    expect(s).toMatchObject({ tripsStarted: 0, inRangePct: null, onTimePct: null, avgTripHours: null, distanceKm: 0 });
  });
});

describe('labels', () => {
  it('grades a percentage in words', () => {
    expect(gradeOf(100)).toBe('good');
    expect(gradeOf(95)).toBe('good');
    expect(gradeOf(90)).toBe('fair');
    expect(gradeOf(60)).toBe('poor');
    expect(gradeOf(null)).toBeNull();
  });
  it('writes a duration in days and hours', () => {
    expect(durationHoursLabel(50, 'en')).toBe('2 d 2 h');
    expect(durationHoursLabel(7, 'en')).toBe('7 h');
    expect(durationHoursLabel(26, 'ar')).toBe('1 يوم 2 ساعة');
  });
});
