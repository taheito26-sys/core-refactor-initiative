import { beforeEach, describe, expect, it } from 'vitest';
import { avatarTone, bucketSeries, initialOf, orderCountChange, orderReferences, splitAmount } from '@/features/orders/v2/orders-v2-model';
import { DEFAULT_ORDERS_DESIGN, readOrdersDesign } from '@/features/orders/v2/design';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('order references', () => {
  it('numbers each day from 001 in the order the orders were placed', () => {
    const refs = orderReferences([
      { id: 'b', ts: at(2026, 10, 19, 13) },
      { id: 'a', ts: at(2026, 10, 19, 10) },
      { id: 'c', ts: at(2026, 10, 19, 16) },
      { id: 'd', ts: at(2026, 10, 22, 14) },
    ]);
    expect(refs.get('a')).toBe('ORD-20261019-001');
    expect(refs.get('b')).toBe('ORD-20261019-002');
    expect(refs.get('c')).toBe('ORD-20261019-003');
    expect(refs.get('d')).toBe('ORD-20261022-001');
  });

  it('breaks a tie by the exchange order number, like the rest of the page', () => {
    const refs = orderReferences([
      { id: 'x', ts: 1000, exchangeOrderNumber: '200' },
      { id: 'y', ts: 1000, exchangeOrderNumber: '100' },
    ]);
    expect(refs.get('y')?.endsWith('-001')).toBe(true);
    expect(refs.get('x')?.endsWith('-002')).toBe(true);
  });

  it('numbers stock batches the same way under their own prefix', () => {
    const refs = orderReferences([{ id: 'b1', ts: at(2026, 10, 5, 9) }, { id: 'b2', ts: at(2026, 10, 5, 11) }], 'BAT');
    expect(refs.get('b1')).toBe('BAT-20261005-001');
    expect(refs.get('b2')).toBe('BAT-20261005-002');
  });
});

describe('buyer avatars', () => {
  it('keeps a buyer on the same colour and takes the first letter', () => {
    expect(avatarTone('Abdullah Al Marri', 6)).toBe(avatarTone(' abdullah al marri ', 6));
    expect(avatarTone('x', 6)).toBeLessThan(6);
    expect(initialOf('  mohamed')).toBe('M');
    expect(initialOf('')).toBe('?');
  });
});

describe('order count change', () => {
  const now = at(2026, 10, 22);
  it('compares a month with the month before it', () => {
    const ts = [at(2026, 10, 1), at(2026, 10, 2), at(2026, 10, 3), at(2026, 9, 5), at(2026, 9, 6)];
    expect(orderCountChange(ts, '2026-10', now)).toBeCloseTo(50);
  });
  it('compares the last 30 days with the 30 before for all time', () => {
    const ts = [now - 1 * 864e5, now - 2 * 864e5, now - 40 * 864e5];
    expect(orderCountChange(ts, 'all', now)).toBeCloseTo(100);
  });
  it('has nothing to say when the period before is empty', () => {
    expect(orderCountChange([at(2026, 10, 1)], '2026-10', now)).toBeNull();
  });
});

describe('bucketSeries', () => {
  it('spreads values over equal slices and sums what lands together', () => {
    expect(bucketSeries([{ ts: 0, value: 1 }, { ts: 1, value: 2 }, { ts: 99, value: 5 }], 2)).toEqual([3, 5]);
    expect(bucketSeries([], 4)).toEqual([]);
  });
});

describe('orders design switch', () => {
  beforeEach(() => localStorage.clear());
  it('opens on the new layout, and ?orders=classic is the way back', () => {
    expect(readOrdersDesign('')).toBe(DEFAULT_ORDERS_DESIGN);
    expect(readOrdersDesign('?orders=classic')).toBe('classic');
    expect(readOrdersDesign('')).toBe('classic');
    expect(readOrdersDesign('?orders=v2')).toBe('v2');
  });
});

describe('splitAmount', () => {
  it('separates the number from its unit and keeps a sign with the number', () => {
    expect(splitAmount('9,698 QAR')).toEqual({ n: '9,698', u: 'QAR' });
    expect(splitAmount('+303 QAR')).toEqual({ n: '+303', u: 'QAR' });
    expect(splitAmount('−1,200 ريال')).toEqual({ n: '−1,200', u: 'ريال' });
    expect(splitAmount('455,495')).toEqual({ n: '455,495', u: '' });
    expect(splitAmount('—')).toEqual({ n: '—', u: '' });
  });
});
