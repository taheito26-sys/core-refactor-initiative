import { describe, expect, it } from 'vitest';
import { driverSummaries, teamTotals, tripsInPeriod } from '@/features/shipments/driver-roster';
import type { TripData } from '@/features/shipments/api';
import type { ShipmentDriver } from '@/features/shipments/types';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const H = 3600_000;
const iso = (h: number) => new Date(NOW - h * H).toISOString();
const driver = (id: string, active = true): ShipmentDriver => ({ id, user_id: `u${id}`, username: id, display_name: `Driver ${id}`, phone: null, truck_plate: null, active, created_at: iso(900) });
const trip = (id: string, driverId: string | null, over: Partial<TripData> = {}): TripData => ({
  id, customer_user_id: 'c', reference: `SH-${id}`, cargo: 'x', weight_tons: 10, target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3,
  driver_id: driverId, status: 'delivered', note: null, started_at: iso(50), delivered_at: iso(10), created_at: iso(60),
  stops: [{ reached_at: iso(50) }, { reached_at: iso(30) }, { reached_at: iso(10) }] as TripData['stops'],
  readings: [{ taken_at: iso(47), is_alert: false }, { taken_at: iso(44), is_alert: true }] as TripData['readings'],
  locations: [], ...over,
});

describe('driverSummaries', () => {
  it('puts drivers on the road first, then available ones, then switched-off ones', () => {
    const drivers = [driver('off', false), driver('free'), driver('busy')];
    const trips = [trip('1', 'busy', { status: 'on_the_road', delivered_at: null }), trip('2', 'free')];
    const s = driverSummaries(drivers, trips, { kind: 'all' }, NOW, 'en');
    expect(s.map((x) => [x.driver.id, x.status])).toEqual([['busy', 'on_the_road'], ['free', 'available'], ['off', 'off']]);
  });

  it('counts only a driver’s own trips, and only those in the period', () => {
    const drivers = [driver('a'), driver('b')];
    const old = trip('3', 'a', { started_at: '2026-08-02T08:00:00Z', delivered_at: '2026-08-05T08:00:00Z' });
    const trips = [trip('1', 'a'), trip('2', 'b'), old];
    const all = driverSummaries(drivers, trips, { kind: 'all' }, NOW, 'en');
    expect(all.find((x) => x.driver.id === 'a')?.stats.tripsStarted).toBe(2);
    const nov = driverSummaries(drivers, trips, { kind: 'month', month: '2026-11' }, NOW, 'en');
    expect(nov.find((x) => x.driver.id === 'a')?.stats.tripsStarted).toBe(1);
    expect(nov.find((x) => x.driver.id === 'b')?.stats.tripsStarted).toBe(1);
  });

  it('measures the temperature record and gives a six month history', () => {
    const s = driverSummaries([driver('a')], [trip('1', 'a')], { kind: 'all' }, NOW, 'en')[0];
    expect(s.stats.readings).toBe(2);
    expect(s.stats.alerts).toBe(1);
    expect(s.stats.inRangePct).toBe(50);
    expect(s.months).toHaveLength(6);
    expect(s.months[5].tripsStarted).toBe(1);
  });

  it('says where the driver is now, in the reader’s language, and since when', () => {
    const t = trip('1', 'a', {
      status: 'on_the_road', delivered_at: null,
      locations: [
        { latitude: 30, longitude: 31, recorded_at: iso(5), place_ar: 'القاهرة', place_en: 'Cairo' },
        { latitude: 31, longitude: 32, recorded_at: iso(1), place_ar: 'بورسعيد', place_en: 'Port Said' },
      ] as TripData['locations'],
    });
    const en = driverSummaries([driver('a')], [t], { kind: 'all' }, NOW, 'en')[0];
    expect(en.currentPlace).toBe('Port Said');
    expect(en.lastSeenAt).toBe(iso(1));
    expect(driverSummaries([driver('a')], [t], { kind: 'all' }, NOW, 'ar')[0].currentPlace).toBe('بورسعيد');
  });

  it('has nothing to report for a driver with no trips', () => {
    const s = driverSummaries([driver('a')], [], { kind: 'all' }, NOW, 'en')[0];
    expect(s.current).toBeNull();
    expect(s.stats.tripsStarted).toBe(0);
    expect(s.stats.inRangePct).toBeNull();
    expect(s.currentPlace).toBeNull();
  });
});

describe('teamTotals', () => {
  it('adds the team up over the period and ignores trips with no driver', () => {
    const drivers = [driver('a'), driver('b')];
    const trips = [trip('1', 'a'), trip('2', 'b', { status: 'on_the_road', delivered_at: null }), trip('3', null)];
    const sums = driverSummaries(drivers, trips, { kind: 'all' }, NOW, 'en');
    const t = teamTotals(drivers, sums, trips, { kind: 'all' }, NOW);
    expect(t.drivers).toBe(2);
    expect(t.onTheRoad).toBe(1);
    expect(t.stats.tripsStarted).toBe(2);
  });

  it('filters trips by period', () => {
    expect(tripsInPeriod([trip('1', 'a')], { kind: 'month', month: '2026-10' })).toHaveLength(0);
  });
});
