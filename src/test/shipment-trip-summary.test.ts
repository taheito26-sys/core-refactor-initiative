import { describe, expect, it } from 'vitest';
import { tripSummary } from '@/features/shipments/trip-summary';

const T0 = Date.parse('2026-11-14T06:00:00Z');
const iso = (h: number) => new Date(T0 + h * 3600_000).toISOString();
const stop = (seq: number, reached: boolean) => ({ id: `s${seq}`, shipment_id: 'x', seq, name_en: `S${seq}`, name_ar: `م${seq}`, kind: 'fixed' as const, reached_at: reached ? iso(seq) : null });
const reading = (h: number, t: number, alert = false) => ({ id: `r${h}`, temperature_c: t, is_alert: alert, taken_at: iso(h) }) as never;
const loc = (h: number, lat: number, lng: number, ar: string | null = null, en: string | null = null) => ({ latitude: lat, longitude: lng, accuracy_m: 10, recorded_at: iso(h), source: 'auto' as const, place_ar: ar, place_en: en });

describe('tripSummary', () => {
  it('measures a trip on the road', () => {
    const s = tripSummary({
      status: 'on_the_road', started_at: iso(0), delivered_at: null,
      stops: [stop(1, true), stop(2, true), stop(3, false)],
      readings: [reading(1, -15), reading(2, -14), reading(3, -9, true), reading(4, -15)],
      locations: [loc(0, 30.0, 31.0), loc(1, 31.0, 31.0, 'بورسعيد', 'Port Said')],
    }, T0 + 5 * 3600_000, 'en');
    expect(s.elapsedMs).toBe(5 * 3600_000);
    expect([s.stopsDone, s.stopsTotal]).toEqual([2, 3]);
    expect(s.readingsCount).toBe(4);
    expect(s.alertCount).toBe(1);
    expect(s.inRangePct).toBe(75);
    expect([s.minC, s.maxC, s.avgC]).toEqual([-15, -9, -13.2]);
    expect(s.distanceKm).toBeGreaterThan(100);
    expect(s.distanceKm).toBeLessThan(120);
    expect(s.lastPlace).toBe('Port Said');
  });

  it('names the place in the reader’s language, and falls back to the other one', () => {
    const base = { status: 'on_the_road' as const, started_at: iso(0), delivered_at: null, stops: [], readings: [] };
    expect(tripSummary({ ...base, locations: [loc(1, 30, 31, 'القاهرة', null)] }, T0, 'en').lastPlace).toBe('القاهرة');
    expect(tripSummary({ ...base, locations: [loc(1, 30, 31, 'القاهرة', 'Cairo')] }, T0, 'ar').lastPlace).toBe('القاهرة');
  });

  it('has nothing to say before the trip starts', () => {
    const s = tripSummary({ status: 'preparing', started_at: null, delivered_at: null, stops: [], readings: [], locations: [] }, T0, 'en');
    expect(s.elapsedMs).toBeNull();
    expect(s.inRangePct).toBeNull();
    expect(s.minC).toBeNull();
    expect(s.distanceKm).toBe(0);
    expect(s.lastPlace).toBeNull();
  });

  it('stops the clock at delivery', () => {
    const s = tripSummary({ status: 'delivered', started_at: iso(0), delivered_at: iso(40), stops: [], readings: [], locations: [] }, T0 + 99 * 3600_000, 'en');
    expect(s.elapsedMs).toBe(40 * 3600_000);
  });
});
