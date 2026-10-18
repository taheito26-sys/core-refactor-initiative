import { describe, expect, it } from 'vitest';
import { fiatPerQar } from '@/features/orders/fiat-conversion';

describe('fiatPerQar', () => {
  it('divides the exchange fiat price by the merchant QAR sell rate', () => {
    expect(fiatPerQar({ fiatPricePerUsdt: 54, sellQarPerUsdt: 3.83 })).toBeCloseTo(14.0992, 3);
  });
  it('falls back to the fiat total over the QAR revenue', () => {
    expect(fiatPerQar({ sellQarPerUsdt: 3.83, fiatTotal: 5400, qarRevenue: 383 })).toBeCloseTo(14.0992, 3);
  });
  it('has no rate until a sell price is entered', () => {
    expect(fiatPerQar({ fiatPricePerUsdt: 54, sellQarPerUsdt: 0 })).toBeNull();
    expect(fiatPerQar({ sellQarPerUsdt: 0 })).toBeNull();
  });
});
