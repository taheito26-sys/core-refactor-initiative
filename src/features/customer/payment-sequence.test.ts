import { describe, expect, it } from 'vitest';
import { monthlyPaymentNumbers } from './payment-sequence';
const at = (month: number, day: number, year = 2026) => new Date(year, month - 1, day, 12).getTime();
describe('monthly cash payment numbers', () => {
  it('starts November at 1 and numbers all payers together despite old note numbers', () => {
    const rows = [
      { key: 'oct-hassan', date: at(10, 31), giver: 'Hassan', typed: 43 },
      { key: 'nov-hassan', date: at(11, 2), giver: 'Hassan', typed: 44 },
      { key: 'nov-damrawi', date: at(11, 1), giver: 'Damrawi', typed: 12 },
      { key: 'dec-damrawi', date: at(12, 1), giver: 'Damrawi', typed: 13 },
    ];
    const numbers = monthlyPaymentNumbers(rows);
    expect(numbers.get('nov-damrawi')).toBe(1);
    expect(numbers.get('nov-hassan')).toBe(2);
    expect(numbers.get('dec-damrawi')).toBe(1);
    expect(numbers.get('oct-hassan')).toBe(1);
  });
  it('keeps year boundaries separate and follows local midnight', () => {
    const numbers = monthlyPaymentNumbers([
      { key: 'dec', date: new Date(2026, 11, 31, 23, 59).getTime() },
      { key: 'jan', date: new Date(2027, 0, 1, 0, 1).getTime() },
      { key: 'last-jan', date: at(1, 1) },
    ]);
    expect([...numbers.values()]).toEqual([1, 1, 1]);
  });
  it('counts pending with completed, skips rejected, and keeps numbering after approval', () => {
    const rows = [
      { key: 'paid', date: at(11, 1), status: 'completed' as const },
      { key: 'denied', date: at(11, 2), status: 'rejected' as const },
      { key: 'waiting', date: at(11, 3), status: 'pending' as const },
    ];
    const pending = monthlyPaymentNumbers(rows);
    expect(pending.get('waiting')).toBe(2);
    expect(pending.has('denied')).toBe(false);
    expect(monthlyPaymentNumbers(rows.map(row => row.key === 'waiting' ? { ...row, status: 'completed' } : row))).toEqual(pending);
  });
  it('gives separate numbers to identical amounts on the same date with stable keys', () => {
    const rows = [{ key: 'payment-b', date: at(11, 1) }, { key: 'payment-a', date: at(11, 1) }];
    expect([...monthlyPaymentNumbers(rows)]).toEqual([['payment-a', 1], ['payment-b', 2]]);
    expect(monthlyPaymentNumbers([...rows].reverse())).toEqual(monthlyPaymentNumbers(rows));
  });
  it('does not consume a number for duplicate identities or invalid dates', () => {
    const numbers = monthlyPaymentNumbers([{ key: 'a', date: at(11, 1) }, { key: 'a', date: at(11, 1) }, { key: 'bad', date: NaN }, { key: 'b', date: at(11, 2) }]);
    expect([...numbers]).toEqual([['a', 1], ['b', 2]]);
  });
});
