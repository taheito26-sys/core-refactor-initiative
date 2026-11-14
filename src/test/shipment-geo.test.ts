import { describe, expect, it } from 'vitest';
import {
  deriveEntryMode, formatCoords, formatStampTime, haversineKm, isFreshFix, mapEmbedUrl, mapsLink, stampLines,
} from '@/features/shipments/geo';

describe('geo', () => {
  it('measures distances between real places: Cairo to Doha is about 2,060 km in a straight line', () => {
    const cairo = { latitude: 30.0444, longitude: 31.2357 };
    const doha = { latitude: 25.2854, longitude: 51.531 };
    const km = haversineKm(cairo, doha);
    expect(km).toBeGreaterThan(2040);
    expect(km).toBeLessThan(2090);
    expect(haversineKm(cairo, cairo)).toBe(0);
  });

  it('writes coordinates with hemisphere letters', () => {
    expect(formatCoords(25.2854, 51.531)).toBe('25.28540°N 51.53100°E');
    expect(formatCoords(-33.8688, -70.5)).toBe('33.86880°S 70.50000°W');
  });

  it('writes the phone time with its UTC offset', () => {
    const ms = Date.UTC(2026, 10, 14, 13, 42, 7);
    expect(formatStampTime(ms, 180)).toBe('14 Nov 2026 16:42:07 UTC+3');
    expect(formatStampTime(ms, 0)).toBe('14 Nov 2026 13:42:07 UTC+0');
    expect(formatStampTime(ms, 330)).toBe('14 Nov 2026 19:12:07 UTC+5:30');
    expect(formatStampTime(ms, -300)).toBe('14 Nov 2026 08:42:07 UTC-5');
  });

  it('builds the two stamp lines: time, shipment and driver; then position and accuracy', () => {
    const [a, b] = stampLines({ capturedAt: Date.UTC(2026, 10, 14, 13, 42, 7), fix: { latitude: 25.2854, longitude: 51.531, accuracy: 12.4 }, reference: 'SH-0004', driverName: 'Ahmed' });
    expect(a).toContain('SH-0004');
    expect(a).toContain('Ahmed');
    expect(a).toMatch(/\d{1,2} Nov 2026 \d{2}:\d{2}:\d{2} UTC[+-]/);
    expect(b).toBe('25.28540°N 51.53100°E ±12 m');
    expect(stampLines({ capturedAt: 0, fix: { latitude: 1, longitude: 2, accuracy: null }, reference: 'X' })[1]).toBe('1.00000°N 2.00000°E');
  });

  it('says how the numbers were entered', () => {
    expect(deriveEntryMode(null, 8.5, -15)).toBe('manual');
    expect(deriveEntryMode({ temperature: 8.5, setPoint: -15 }, 8.5, -15)).toBe('auto');
    expect(deriveEntryMode({ temperature: 8.5, setPoint: -15 }, 8.0, -15)).toBe('auto_edited');
    expect(deriveEntryMode({ temperature: 8.5, setPoint: null }, 8.5, -15)).toBe('auto');
    expect(deriveEntryMode({ temperature: 8.5, setPoint: -15 }, 8.5, -18)).toBe('auto_edited');
  });

  it('builds map links centred on the point', () => {
    expect(mapEmbedUrl(25.2854, 51.531)).toContain('marker=25.28540,51.53100');
    expect(mapEmbedUrl(25.2854, 51.531)).toMatch(/bbox=51\.48100,25\.25540,51\.58100,25\.31540/);
    expect(mapsLink(25.2854, 51.531)).toBe('https://www.google.com/maps?q=25.285400,51.531000');
  });

  it('treats an old fix as stale, and a fix from the future as wrong', () => {
    expect(isFreshFix({ timestamp: 1000 }, 1000 + 60_000, 120_000)).toBe(true);
    expect(isFreshFix({ timestamp: 1000 }, 1000 + 600_000, 120_000)).toBe(false);
    expect(isFreshFix({ timestamp: 1000 + 600_000 }, 1000, 120_000)).toBe(false);
  });
});
