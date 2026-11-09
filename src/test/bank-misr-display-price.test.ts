import { describe, expect, it } from 'vitest';
import { BANK_MISR_PRICE_MARGIN_EGP, bankMisrDisplayPrice } from '@/features/customer/bank-rate/display-price';

describe('bankMisrDisplayPrice', () => {
  it('takes 25 piasters off the sell price', () => {
    expect(BANK_MISR_PRICE_MARGIN_EGP).toBe(0.25);
    expect(bankMisrDisplayPrice(14.7)).toBe(14.45);
    expect(bankMisrDisplayPrice(14.8251)).toBe(14.5751);
  });

  it('returns null for a bad or non-positive result rather than a nonsense price', () => {
    expect(bankMisrDisplayPrice(Number.NaN)).toBeNull();
    expect(bankMisrDisplayPrice(0.25)).toBeNull();
  });
});
