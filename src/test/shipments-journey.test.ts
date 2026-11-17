import { describe, expect, it } from 'vitest';
import { dayPartLabel, estimateArrival, fitTrail, journeyPercent, MAP_ROUTE, spreadAlong } from '@/features/shipments/journey';
import type { ShipmentStop } from '@/features/shipments/types';

const stop = (seq: number, reached: string | null): ShipmentStop => ({ id: `s${seq}`, shipment_id: 'x', seq, name_en: `S${seq}`, name_ar: `س${seq}`, kind: 'fixed', reached_at: reached });
const H = 3600_000;
const t0 = Date.parse('2026-11-10T00:00:00Z');
const at = (h: number) => new Date(t0 + h * H).toISOString();

describe('journey', () => {
  it('counts finished legs as progress', () => {
    expect(journeyPercent({ reachedCount: 0, total: 6 }, false)).toBe(0);
    expect(journeyPercent({ reachedCount: 1, total: 6 }, false)).toBe(0);
    expect(journeyPercent({ reachedCount: 4, total: 6 }, false)).toBe(60);
    expect(journeyPercent({ reachedCount: 2, total: 6 }, true)).toBe(100);
  });

  it('estimates arrival from the truck\'s own pace per leg', () => {
    const stops = [stop(1, at(0)), stop(2, at(10)), stop(3, at(20)), stop(4, null), stop(5, null)];
    const eta = estimateArrival({ status: 'on_the_road', started_at: at(0), delivered_at: null }, stops, t0 + 21 * H);
    expect(eta?.at).toBe(t0 + 40 * H);
    expect(eta?.slow).toBe(false);
    const slow = estimateArrival({ status: 'on_the_road', started_at: at(0), delivered_at: null }, stops, t0 + 40 * H);
    expect(slow?.slow).toBe(true);
  });

  it('gives no estimate before a leg is finished or when not on the road', () => {
    const stops = [stop(1, at(0)), stop(2, null)];
    expect(estimateArrival({ status: 'on_the_road', started_at: at(0), delivered_at: null }, stops, t0)).toBeNull();
    expect(estimateArrival({ status: 'preparing', started_at: null, delivered_at: null }, stops, t0)).toBeNull();
  });

  it('names a day and a part of the day', () => {
    expect(dayPartLabel(new Date(2026, 10, 19, 9).getTime(), 'en')).toBe('Thursday, morning');
    expect(dayPartLabel(new Date(2026, 10, 19, 14).getTime(), 'ar')).toContain('ظهرًا');
  });

  it('spreads stops from the first to the last corner of the route', () => {
    const pts = spreadAlong(MAP_ROUTE, 6);
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual(MAP_ROUTE[0]);
    expect(pts[5].x).toBeCloseTo(MAP_ROUTE[MAP_ROUTE.length - 1].x, 5);
  });

  it('fits real positions into the box with north up and the true proportions', () => {
    const pts = fitTrail([{ latitude: 30, longitude: 31 }, { latitude: 25, longitude: 51.5 }], 300, 180)!;
    expect(pts[0].x).toBeLessThan(pts[1].x);
    expect(pts[0].y).toBeLessThan(pts[1].y);
    expect(pts.every(q => q.x >= 0 && q.x <= 300 && q.y >= 0 && q.y <= 180)).toBe(true);
    expect(fitTrail([{ latitude: 1, longitude: 1 }], 300, 180)).toBeNull();
    expect(fitTrail([{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }], 300, 180)).toBeNull();
  });
});

import { temperatureVerdict } from '@/features/shipments/route';
describe('temperatureVerdict', () => {
  it('says how far past the nearest limit a reading is', () => {
    expect(temperatureVerdict(-15, -15, 3)).toMatchObject({ state: 'ok', offBy: 0, low: -18, high: -12 });
    expect(temperatureVerdict(-12, -15, 3).state).toBe('ok');
    expect(temperatureVerdict(8.5, -15, 3)).toMatchObject({ state: 'warm', offBy: 20.5 });
    expect(temperatureVerdict(-22, -15, 3)).toMatchObject({ state: 'cold', offBy: 4 });
  });
});
