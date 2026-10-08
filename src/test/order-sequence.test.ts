import { describe, expect, it } from 'vitest';
import { comparePlacement, compareOrderNumbers, toLocalInputValue } from '@/lib/order-sequence';

describe('order sequence', () => {
  it('orders by placement time, then by exchange order number', () => {
    const rows = [
      { ts: 2000, orderNumber: '22000000000000000002', id: 'b' },
      { ts: 1000, orderNumber: '22000000000000000009', id: 'z' },
      { ts: 2000, orderNumber: '22000000000000000001', id: 'a' },
    ].sort(comparePlacement);
    expect(rows.map(r => r.id)).toEqual(['z', 'a', 'b']);
  });

  it('compares long order numbers without precision loss', () => {
    expect(compareOrderNumbers('22750000000000000001', '22750000000000000002')).toBeLessThan(0);
    expect(compareOrderNumbers('9', '10')).toBeLessThan(0);
    expect(compareOrderNumbers('abc', '10')).toBe(0);
  });

  it('round-trips a datetime-local value in local time', () => {
    const ts = new Date(2026, 9, 8, 12, 35).getTime();
    expect(new Date(toLocalInputValue(ts)).getTime()).toBe(ts);
  });
});
