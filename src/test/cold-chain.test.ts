import { describe, expect, it } from 'vitest';
import { coldChainStats } from '@/features/shipments/cold-chain';
import type { ShipmentReading } from '@/features/shipments/types';

const at = (hour: number) => `2026-11-18T${String(hour).padStart(2, '0')}:00:00Z`;
const reading = (hour: number, temperature_c: number, is_alert = false): ShipmentReading => ({
  id: `r${hour}-${temperature_c}`, shipment_id: 'sh', temperature_c, set_point_c: -15, photo_path: 'x',
  note: null, is_alert, taken_at: at(hour), latitude: null, longitude: null, accuracy_m: null,
  device_taken_at: at(hour), time_mismatch: false, entry_mode: 'auto', place_ar: null, place_en: null,
});

describe('coldChainStats', () => {
  it('summarises a mostly stable record and flags the excursion', () => {
    const s = coldChainStats([
      reading(8, -15), reading(9, -14), reading(10, 8.5, true), reading(11, -16),
    ], -15, 3, new Date('2026-11-18T12:00:00Z').getTime());
    expect(s.readingCount).toBe(4);
    expect(s.inRangeCount).toBe(3);
    expect(s.alertCount).toBe(1);
    expect(s.inRangePct).toBe(75);
    expect(s.minC).toBe(-16);
    expect(s.maxC).toBe(8.5);
    expect(s.excursionCount).toBe(1);
    expect(s.longestExcursionMs).toBe(60 * 60_000);
    expect(s.score).toBeLessThan(90);
    expect(s.band).not.toBe('stable');
  });

  it('returns an empty profile with no readings', () => {
    const s = coldChainStats([], -15, 3, Date.now());
    expect(s.readingCount).toBe(0);
    expect(s.inRangePct).toBeNull();
    expect(s.avgC).toBeNull();
    expect(s.score).toBe(0);
    expect(s.band).toBe('none');
  });

  it('counts separate excursions and keeps the longest run', () => {
    const s = coldChainStats([
      reading(8, 8, true), reading(9, 9, true), reading(10, -15), reading(11, 10, true), reading(12, -14),
    ], -15, 3, new Date('2026-11-18T13:00:00Z').getTime());
    expect(s.excursionCount).toBe(2);
    expect(s.longestExcursionMs).toBe(2 * 60 * 60_000);
    expect(s.inRangePct).toBe(40);
  });
});
