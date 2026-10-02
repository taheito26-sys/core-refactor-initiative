import { describe, expect, it } from 'vitest';
import {
  allocateFee, evenSplit, exactCustomerMatch, formatQty, legLoanPrincipal, matchCustomerOptions,
  otherHalf, validateSplitPlan,
} from '@/features/orders/split-plan';

describe('otherHalf', () => {
  it('always adds back up to the total', () => {
    expect(otherHalf(4999.97, '1802')).toBe('3197.97');
    expect(otherHalf(100, '33.33333333')).toBe('66.66666667');
  });
  it('is empty when the typed half is the whole order or more', () => {
    expect(otherHalf(100, '100')).toBe('');
    expect(otherHalf(100, '250')).toBe('');
  });
  it('gives the whole order to the other half for empty or invalid input', () => {
    expect(otherHalf(100, '')).toBe('100');
    expect(otherHalf(100, 'abc')).toBe('100');
  });
});

describe('evenSplit', () => {
  it('halves with the second taking the exact remainder', () => {
    expect(evenSplit(5000)).toEqual(['2500', '2500']);
    const [a, b] = evenSplit(4999.97);
    expect(Number(a) + Number(b)).toBeCloseTo(4999.97, 8);
  });
  it('is empty without a positive total', () => {
    expect(evenSplit(0)).toEqual(['', '']);
  });
});

describe('allocateFee', () => {
  it('divides the fee by quantity and the halves sum to the fee', () => {
    const [a, b] = allocateFee(10, 3, 1);
    expect(a).toBe(7.5);
    expect(a + b).toBe(10);
  });
  it('never invents a fee', () => {
    expect(allocateFee(0, 1, 1)).toEqual([0, 0]);
  });
  it('keeps the exact total even when the share does not round evenly', () => {
    const [a, b] = allocateFee(1, 1, 2);
    expect(Math.round((a + b) * 100) / 100).toBe(1);
  });
});

describe('legLoanPrincipal', () => {
  it('is revenue less fee, per half', () => {
    expect(legLoanPrincipal(3197.97, 3.705, 0)).toBeCloseTo(11848.48, 2);
    expect(legLoanPrincipal(1802, 3.8, 0)).toBeCloseTo(6847.6, 2);
  });
  it('is never negative', () => {
    expect(legLoanPrincipal(1, 1, 50)).toBe(0);
  });
});

describe('validateSplitPlan', () => {
  const ok = { total: 100, qtyA: 60, qtyB: 40, priceA: 3.7, priceB: 3.8, hasBuyerA: true, hasBuyerB: true, sameBuyer: false };
  it('accepts a complete plan', () => expect(validateSplitPlan(ok)).toBeNull());
  it('needs a quantity on both halves', () => {
    expect(validateSplitPlan({ ...ok, qtyB: 0 })).toBe('qty_invalid');
  });
  it('needs the halves to add up to the order', () => {
    expect(validateSplitPlan({ ...ok, qtyA: 70 })).toBe('qty_too_large');
  });
  it('needs a price on both halves', () => {
    expect(validateSplitPlan({ ...ok, priceB: 0 })).toBe('price_invalid');
  });
  it('needs two different buyers', () => {
    expect(validateSplitPlan({ ...ok, hasBuyerA: false })).toBe('buyer_missing');
    expect(validateSplitPlan({ ...ok, hasBuyerB: false })).toBe('second_buyer_missing');
    expect(validateSplitPlan({ ...ok, sameBuyer: true })).toBe('same_buyer');
  });
});

describe('customer autocomplete', () => {
  const options = [
    { id: '1', name: 'Mohamed Sherif', phone: '+974 1' },
    { id: '2', name: 'Mohamed Al-Damrawy', nameAr: 'محمد الدمراوي', phone: '+974 7' },
    { id: '3', name: 'Hatem' },
  ];
  it('ranks exact, then prefix, then contains, then phone', () => {
    expect(matchCustomerOptions(options, 'hatem').map(o => o.id)).toEqual(['3']);
    expect(matchCustomerOptions(options, 'moh').map(o => o.id)).toEqual(['1', '2']);
    expect(matchCustomerOptions(options, 'damrawy').map(o => o.id)).toEqual(['2']);
    expect(matchCustomerOptions(options, '+974 7').map(o => o.id)).toEqual(['2']);
  });
  it('finds by the other language name', () => {
    expect(matchCustomerOptions(options, 'الدمراوي').map(o => o.id)).toEqual(['2']);
  });
  it('can leave out the other half\'s customer', () => {
    expect(matchCustomerOptions(options, 'moh', '1').map(o => o.id)).toEqual(['2']);
  });
  it('resolves a typed name to one customer only when it is unambiguous', () => {
    expect(exactCustomerMatch(options, ' hatem ')?.id).toBe('3');
    expect(exactCustomerMatch(options, 'moh')).toBeNull();
  });
});

describe('formatQty', () => {
  it('drops float dust and empties non-positive values', () => {
    expect(formatQty(3197.9699999999993)).toBe('3197.97');
    expect(formatQty(0)).toBe('');
  });
});
