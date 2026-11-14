import { describe, expect, it } from 'vitest';
import {
  FIXED_ROUTE, agoLabel, durationLabel, fixedRouteForRpc, isOutOfRange, latestReading, parseTemperatureInput,
  readingDue, stopProgress, toggleSign,
} from '@/features/shipments/route';
import type { ShipmentReading, ShipmentStop } from '@/features/shipments/types';

const stop = (seq: number, reached: string | null, kind: 'fixed' | 'driver' = 'fixed'): ShipmentStop => ({
  id: `s${seq}`, shipment_id: 'sh', seq, name_en: `Stop ${seq}`, name_ar: `محطة ${seq}`, kind, reached_at: reached,
});

describe('route', () => {
  it('starts in Egypt and ends in Qatar, with the stops in driving order', () => {
    expect(FIXED_ROUTE[0].nameEn).toContain('Obour');
    expect(FIXED_ROUTE.map((s) => s.nameEn)).toEqual([
      'Obour (Cairo)', 'Kafr El Sheikh', 'Port Said', 'Safaga port', 'Saudi Arabia', 'Qatar (delivery)',
    ]);
    expect(FIXED_ROUTE.at(-1)?.nameAr).toContain('قطر');
    expect(fixedRouteForRpc()[1]).toEqual({ name_en: 'Kafr El Sheikh', name_ar: 'كفر الشيخ' });
  });

  it('reports progress, with a driver-added stop sitting between two fixed ones', () => {
    const p = stopProgress([stop(30, null), stop(10, '2026-11-14T10:00:00Z'), stop(15, null, 'driver'), stop(20, null)]);
    expect(p.stops.map((s) => s.seq)).toEqual([10, 15, 20, 30]);
    expect(p.reachedCount).toBe(1);
    expect(p.current?.seq).toBe(10);
    expect(p.next?.seq).toBe(15);
    expect(p.origin?.seq).toBe(10);
    expect(p.destination?.seq).toBe(30);
  });

  it('has no current stop before the trip starts and no next stop once everything is reached', () => {
    expect(stopProgress([stop(10, null), stop(20, null)]).current).toBeNull();
    const done = stopProgress([stop(10, 'a'), stop(20, 'b')]);
    expect(done.next).toBeNull();
    expect(done.current?.seq).toBe(20);
  });
});

describe('temperature', () => {
  it('flags a reading outside the band around the target', () => {
    expect(isOutOfRange(-14, -15, 3)).toBe(false);
    expect(isOutOfRange(-12, -15, 3)).toBe(false);
    expect(isOutOfRange(-11.9, -15, 3)).toBe(true);
    expect(isOutOfRange(8.5, -15, 3)).toBe(true);
  });

  it('parses what a driver types, including comma decimals, Arabic digits and a typographic minus', () => {
    expect(parseTemperatureInput('8.5')).toBe(8.5);
    expect(parseTemperatureInput('-15')).toBe(-15);
    expect(parseTemperatureInput('٨٫٥')).toBe(8.5);
    expect(parseTemperatureInput('−15,5')).toBe(-15.5);
    expect(parseTemperatureInput('')).toBeNull();
    expect(parseTemperatureInput('abc')).toBeNull();
    expect(parseTemperatureInput('85')).toBeNull();
    expect(parseTemperatureInput('-61')).toBeNull();
    expect(parseTemperatureInput('1.234')).toBeNull();
  });

  it('toggles the sign for keypads without a minus key', () => {
    expect(toggleSign('15')).toBe('-15');
    expect(toggleSign('-15')).toBe('15');
    expect(toggleSign('')).toBe('-');
  });

  it('finds the newest reading', () => {
    const r = (id: string, at: string) => ({ id, taken_at: at }) as ShipmentReading;
    expect(latestReading([r('a', '2026-11-14T08:00:00Z'), r('b', '2026-11-14T11:00:00Z'), r('c', '2026-11-14T09:00:00Z')])?.id).toBe('b');
    expect(latestReading([])).toBeNull();
  });
});

describe('readingDue', () => {
  const ship = { status: 'on_the_road' as const, started_at: '2026-11-14T08:00:00Z', reading_interval_hours: 3 };
  const at = (iso: string) => new Date(iso).getTime();

  it('counts from the trip start until the first reading, then from the last reading', () => {
    expect(readingDue(ship, null, at('2026-11-14T09:00:00Z')).state).toBe('ok');
    expect(readingDue(ship, null, at('2026-11-14T10:45:00Z')).state).toBe('due_soon');
    const late = readingDue(ship, null, at('2026-11-14T12:00:00Z'));
    expect(late.state).toBe('overdue');
    expect(late.overdueMs).toBe(60 * 60 * 1000);
    expect(readingDue(ship, '2026-11-14T11:30:00Z', at('2026-11-14T12:00:00Z')).state).toBe('ok');
  });

  it('is idle unless the shipment is on the road', () => {
    expect(readingDue({ ...ship, status: 'preparing' }, null, Date.now()).state).toBe('idle');
    expect(readingDue({ ...ship, status: 'delivered' }, null, Date.now()).state).toBe('idle');
  });
});

describe('labels', () => {
  const now = new Date('2026-11-14T12:00:00Z').getTime();
  it('says how long ago in both languages', () => {
    expect(agoLabel('2026-11-14T11:42:00Z', now, 'en')).toBe('18 min ago');
    expect(agoLabel('2026-11-14T10:00:00Z', now, 'en')).toBe('2 h ago');
    expect(agoLabel('2026-11-11T12:00:00Z', now, 'en')).toBe('3 d ago');
    expect(agoLabel('2026-11-14T11:42:00Z', now, 'ar')).toBe('منذ 18 دقيقة');
    expect(agoLabel('2026-11-14T12:00:00Z', now, 'en')).toBe('just now');
  });
  it('formats durations', () => {
    expect(durationLabel(135 * 60_000, 'en')).toBe('2 h 15 min');
    expect(durationLabel(120 * 60_000, 'en')).toBe('2 h');
    expect(durationLabel(20 * 60_000, 'ar')).toBe('20 دقيقة');
  });
});
