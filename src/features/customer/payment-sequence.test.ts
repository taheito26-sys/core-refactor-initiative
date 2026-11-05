import { describe, expect, it } from 'vitest';
import { monthlyPaymentNumbers, monthlyGiverPaymentNumbers } from './payment-sequence';
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

describe('monthly payment numbers per giver', () => {
  it('counts Damrawi and Hassan independently and ignores old note numbers', () => {
    const rows = [
      { key: 'old', date: at(10, 31), giver: 'Damrawi', typed: 43 },
      { key: 'd1', date: at(11, 1), giver: 'Damrawi', typed: 44 },
      { key: 'h1', date: at(11, 2), giver: 'Hassan', typed: 12 },
      { key: 'd2', date: at(11, 3), giver: 'Damrawi' },
      { key: 'h2', date: at(11, 4), giver: 'Hassan' },
      { key: 'd3', date: at(11, 5), giver: 'Damrawi' },
      { key: 'next-d', date: at(12, 1), giver: 'Damrawi' },
      { key: 'next-h', date: at(12, 1), giver: 'Hassan' },
    ];
    const numbers = monthlyGiverPaymentNumbers(rows);
    expect(['d1', 'd2', 'd3'].map(key => numbers.get(key))).toEqual([1, 2, 3]);
    expect(['h1', 'h2'].map(key => numbers.get(key))).toEqual([1, 2]);
    expect(numbers.get('next-d')).toBe(1);
    expect(numbers.get('next-h')).toBe(1);
  });
  it('normalizes giver names and skips rejected or unnamed payments', () => {
    const numbers = monthlyGiverPaymentNumbers([
      { key: 'h1', date: at(11, 1), giver: 'حَسَن' },
      { key: 'rejected', date: at(11, 2), giver: 'حسن', status: 'rejected' },
      { key: 'h2', date: at(11, 3), giver: ' حسن ', status: 'pending' },
      { key: 'unnamed', date: at(11, 4), giver: null },
      { key: 'blank', date: at(11, 4), giver: ' ' },
    ]);
    expect([...numbers]).toEqual([['h1', 1], ['h2', 2]]);
  });
  it('has stable independent counters on equal timestamps, across years and after approval', () => {
    const rows = [
      { key: 'h2', date: at(11, 1), giver: 'Hassan', status: 'pending' as const },
      { key: 'd1', date: at(11, 1), giver: 'Damrawi' },
      { key: 'h1', date: at(11, 1), giver: 'Hassan' },
      { key: 'new-year', date: at(11, 1, 2027), giver: 'Hassan' },
    ];
    const numbers = monthlyGiverPaymentNumbers(rows);
    expect(numbers.get('h1')).toBe(1);
    expect(numbers.get('h2')).toBe(2);
    expect(numbers.get('d1')).toBe(1);
    expect(numbers.get('new-year')).toBe(1);
    expect(monthlyGiverPaymentNumbers([...rows].reverse())).toEqual(numbers);
    expect(monthlyGiverPaymentNumbers(rows.map(row => ({ ...row, status: 'completed' })))).toEqual(numbers);
  });
});
