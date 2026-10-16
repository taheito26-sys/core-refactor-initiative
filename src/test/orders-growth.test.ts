import { describe, expect, it } from 'vitest';
import { growth, monthFigures, monthOf, previousMonth, type GrowthRow } from '@/features/customer/orders/orders-growth';

const at = (m: number, d = 10) => new Date(2026, m - 1, d, 12).getTime();
const loan = (m: number, amount: number, egp = amount * 14): GrowthRow => ({ date: at(m), totalAmount: egp, currency: 'EGP', loanAmount: amount, loanCurrency: 'QAR', qarToEgpRate: 14 });

describe('orders growth', () => {
  it('keys months in local time and steps back across a year end', () => {
    expect(monthOf(at(10))).toBe('2026-10');
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('computes the same tiles per month and the running debt', () => {
    const rows = [loan(9, 1000), loan(9, 500), loan(10, 2000)];
    expect(monthFigures(rows, '2026-10')).toMatchObject({ count: 1, totalQar: 2000, volumeEgp: 28000, debtThrough: 3500 });
    expect(monthFigures(rows, '2026-09')).toMatchObject({ count: 2, totalQar: 1500, debtThrough: 1500 });
  });

  it('counts a sale by its QAR equivalent', () => {
    const sale: GrowthRow = { date: at(10), totalAmount: 1400, currency: 'EGP', loanAmount: null, loanCurrency: null, sale: true, qarToEgpRate: 14 };
    expect(monthFigures([sale], '2026-10').totalQar).toBeCloseTo(100);
  });

  it('reports percent and absolute change, and nothing to compare against when last month was empty', () => {
    expect(growth(112, 100)).toEqual({ pct: 12, delta: 12, up: true });
    expect(growth(80, 100)).toEqual({ pct: -20, delta: -20, up: false });
    expect(growth(5, 0)).toEqual({ pct: null, delta: 5, up: true });
  });
});
