import { describe, expect, it } from 'vitest';
import { journeyPlan } from '@/features/shipments/journey-pulse';
import type { ShipmentStop, ShipmentWithDetails } from '@/features/shipments/types';

const NOW = new Date('2026-11-17T11:00:00+03:00').getTime();
const iso = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const stop = (seq: number, en: string, ar: string, lat: number, lng: number, reachedHours: number | null): ShipmentStop => ({
  id: `s${seq}`, shipment_id: 'x', seq, name_en: en, name_ar: ar, kind: 'fixed',
  reached_at: reachedHours == null ? null : iso(reachedHours), latitude: lat, longitude: lng,
});

const stops = [
  stop(1, 'Obour (Cairo)', 'العبور', 30.228, 31.482, 34),
  stop(2, 'Kafr El Sheikh', 'كفر الشيخ', 31.111, 30.939, 30),
  stop(3, 'Port Said', 'بورسعيد', 31.265, 32.302, 24),
  stop(4, 'Safaga port', 'ميناء سفاجا', 26.733, 33.936, null),
  stop(5, 'Saudi Arabia', 'السعودية', 26.2, 44.0, null),
  stop(6, 'Qatar (delivery)', 'قطر (التسليم)', 25.285, 51.531, null),
];

const base = (over: Partial<ShipmentWithDetails> = {}): ShipmentWithDetails => ({
  id: 'x', customer_user_id: 'c', reference: 'SH-0001', cargo: 'Frozen fish', weight_tons: 12,
  target_temp_c: -15, tolerance_c: 3, reading_interval_hours: 3, driver_id: 'd', status: 'on_the_road',
  note: null, started_at: iso(34), delivered_at: null, current_started_at: iso(34), created_at: iso(40),
  driver: { id: 'd', display_name: 'Ahmed', truck_plate: 'T1', phone: '+20100' },
  stops,
  readings: [
    { id: 'r1', shipment_id: 'x', temperature_c: -15, set_point_c: -15, photo_path: 'x', note: null, is_alert: false, taken_at: iso(1), latitude: 31.2, longitude: 32.2, accuracy_m: 10, device_taken_at: iso(1), time_mismatch: false, entry_mode: 'auto', place_ar: null, place_en: null },
    { id: 'r2', shipment_id: 'x', temperature_c: -14, set_point_c: -15, photo_path: 'x', note: null, is_alert: false, taken_at: iso(4), latitude: 31.1, longitude: 32.0, accuracy_m: 10, device_taken_at: iso(4), time_mismatch: false, entry_mode: 'auto', place_ar: null, place_en: null },
  ],
  locations: [
    { latitude: 31.1, longitude: 32.15, accuracy_m: 10, recorded_at: iso(0.4), source: 'auto', place_ar: null, place_en: null },
  ],
  ...over,
});

describe('journeyPlan', () => {
  it('counts confirmed stops for progress and puts the next stop in the middle milestone', () => {
    const plan = journeyPlan(base(), NOW, 'en');
    expect(plan.progressPct).toBe(50);
    expect(plan.reachedCount).toBe(3);
    expect(plan.total).toBe(6);
    expect(plan.nextStop?.name_en).toBe('Safaga port');
    expect(plan.milestones.map((m) => m.key)).toEqual(['origin', 'waypoint', 'destination']);
    expect(plan.milestones[1].state).toBe('next');
    expect(plan.milestones[1].name).toBe('Safaga port');
    expect(plan.milestones[1].caption).toContain('516 km');
    expect(plan.milestones[2].state).toBe('waiting');
  });

  it('puts the truck on the corridor and measures the distance to the next stop', () => {
    const plan = journeyPlan(base(), NOW, 'en');
    expect(plan.truck).not.toBeNull();
    expect(plan.truckAtStop).toBe(false);
    expect(plan.corridorStops).toHaveLength(6);
    expect(plan.corridorStops.filter((s) => s.reached)).toHaveLength(3);
    expect(plan.corridorStops[1].atPct).toBe(20);
    expect(plan.distanceToNextKm).toBeGreaterThan(400);
  });

  it('marks a delivered trip complete and uses the last intermediate stop, not the destination twice', () => {
    const delivered = base({
      status: 'delivered', delivered_at: iso(2),
      stops: stops.map((s) => ({ ...s, reached_at: s.reached_at ?? iso(3) })),
    });
    const plan = journeyPlan(delivered, NOW, 'en');
    expect(plan.progressPct).toBe(100);
    expect(plan.etaLabel).toBeTruthy();
    expect(plan.milestones.map((m) => m.name)).toEqual(['Obour (Cairo)', 'Saudi Arabia', 'Qatar (delivery)']);
    expect(plan.milestones[2].state).toBe('done');
  });

  it('does not duplicate the origin as a next stop before the trip starts', () => {
    const preparing = base({
      status: 'preparing', started_at: null, current_started_at: null,
      stops: stops.map((s) => ({ ...s, reached_at: null })), readings: [], locations: [],
    });
    const plan = journeyPlan(preparing, NOW, 'en');
    expect(plan.progressPct).toBe(0);
    expect(plan.etaMs).toBeNull();
    expect(plan.milestones).toHaveLength(3);
    expect(plan.milestones[1].name).toBe('Waiting to depart');
    expect(plan.truck).not.toBeNull();
    expect(plan.coldChainTone).toBe('muted');
  });

  it('turns the cold-chain verdict red on an alert reading', () => {
    const alert = base({ readings: [{ ...base().readings[0], temperature_c: 8.5, is_alert: true }] });
    const plan = journeyPlan(alert, NOW, 'ar');
    expect(plan.coldChainTone).toBe('bad');
    expect(plan.coldChainLabel).toBe('تنبيه سلسلة التبريد');
    expect(plan.alertCount).toBe(1);
    expect(plan.inRangePct).toBe(0);
  });

  it('reports the live status and next-stop ETA in Arabic', () => {
    const plan = journeyPlan(base(), NOW, 'ar');
    expect(plan.statusNow).toBe('بورسعيد');
    expect(plan.statusHint).toContain('غادر');
    expect(plan.nextEtaMs).toBeGreaterThan(NOW);
    expect(plan.milestones[1].caption).toContain('516');
  });

  it('wires every stop to an actual or estimated time and totals the trip', () => {
    const plan = journeyPlan(base(), NOW, 'en');
    expect(plan.stopEtas).toHaveLength(6);
    expect(plan.stopEtas[0]).toMatchObject({ state: 'done', reached: true });
    expect(plan.stopEtas[2].state).toBe('done');
    expect(plan.stopEtas[3]).toMatchObject({ state: 'next', next: true });
    expect(plan.stopEtas[3].timeLabel).toBeTruthy();
    expect(plan.stopEtas[4].timeLabel).toBeTruthy();
    expect(plan.stopEtas[5].timeLabel).toBeTruthy();
    expect(plan.stopEtas[5].etaMs).toBeCloseTo(plan.etaMs!, -3);
    expect(plan.totalTripLabel).not.toBe('—');
    expect(plan.remainingLabel).not.toBe('—');
    expect(plan.remainingMs).toBeGreaterThan(0);
  });

  it('shows the planned duration without inventing arrival times before departure', () => {
    const preparing = base({
      status: 'preparing', started_at: null, current_started_at: null,
      stops: stops.map((s) => ({ ...s, reached_at: null })), readings: [], locations: [],
    });
    const plan = journeyPlan(preparing, NOW, 'en');
    expect(plan.stopEtas.every((s) => s.timeLabel === null)).toBe(true);
    expect(plan.totalTripLabel).not.toBe('—');
    expect(plan.remainingLabel).toBe('After departure');
  });

  it('anchors pace to confirmed legs and lets GPS progress shorten the ETA', () => {
    const atNext = base({
      locations: [{
        latitude: 26.733, longitude: 33.936, accuracy_m: 10, recorded_at: iso(0.4),
        source: 'auto', place_ar: null, place_en: null,
      }],
    });
    const early = journeyPlan(atNext, NOW, 'en');
    const later = journeyPlan(atNext, NOW + 10 * 3600_000, 'en');
    // The same fix ten hours later means the truck has stood still; the ETA should slip by ten hours,
    // not by ten hours plus an inflated pace for the unfinished leg.
    expect(later.etaMs! - early.etaMs!).toBeCloseTo(10 * 3600_000, -3);

    const atLastStop = journeyPlan(base(), NOW, 'en');
    // A fix at the next stop must arrive materially earlier than the same trip still at the last stop.
    expect(early.etaMs!).toBeLessThan(atLastStop.etaMs! - 5 * 3600_000);
  });
});
