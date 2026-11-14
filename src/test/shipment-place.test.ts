import { describe, expect, it } from 'vitest';
import { cacheKey, placeFromAddress, validCoordinates } from '../../supabase/functions/reverse-geocode/place';

describe('placeFromAddress', () => {
  it('names the district, city, region and country without repeats', () => {
    const p = placeFromAddress({ suburb: 'Al-Arab', city: 'Port Said', state: 'Port Said', country: 'Egypt' });
    expect(p?.label).toBe('Al-Arab, Port Said, Egypt');
    expect(p).toMatchObject({ district: 'Al-Arab', city: 'Port Said', region: 'Port Said', country: 'Egypt' });
  });

  it('falls back through the names a place can have', () => {
    expect(placeFromAddress({ neighbourhood: 'X', town: 'Y', state: 'Z', country: 'C' })?.label).toBe('X, Y, Z, C');
    expect(placeFromAddress({ village: 'V', county: 'K', country: 'C' })?.label).toBe('V, C');
    expect(placeFromAddress({ country: 'Qatar' })?.label).toBe('Qatar');
  });

  it('gives nothing for an empty or missing address', () => {
    expect(placeFromAddress({})).toBeNull();
    expect(placeFromAddress(null)).toBeNull();
    expect(placeFromAddress({ city: '   ' })).toBeNull();
  });
});

describe('helpers', () => {
  it('shares one cache entry between points about a kilometre apart', () => {
    expect(cacheKey(31.2601, 32.3012)).toBe(cacheKey(31.2649, 32.2988));
    expect(cacheKey(31.26, 32.3)).not.toBe(cacheKey(31.4, 32.3));
  });
  it('accepts only real coordinates', () => {
    expect(validCoordinates(25.2, 51.5)).toBe(true);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates('1', 2)).toBe(false);
    expect(validCoordinates(NaN, 2)).toBe(false);
  });
});
