import { describe, it, expect } from 'vitest';
import { buildCalendarMonth, leadPayment } from '@/features/calendar/calendar-model';
import { buildStateFrom } from '@/lib/tracker-state';
import type { Trade } from '@/lib/tracker-helpers';

const trade = (id: string, day: number, extra: Partial<Trade> = {}): Trade => ({
  id, ts: new Date(2026, 9, day, 12).getTime(), inputMode: 'USDT', amountUSDT: 1000,
  sellPriceQAR: 4, manualBuyPrice: 3, feeQAR: 10, usesStock: false, note: '', voided: false,
  customerId: '', revisions: [], ...extra,
});

describe('trading calendar month data', () => {
  it('preserves manual profit, partner shares and excludes voided or duplicate trades', () => {
    const a = trade('a', 3);
    const { state, derived } = buildStateFrom({ trades: [a, a, trade('b', 4, { linkedRelId: 'partner', merchantPct: 25 }), trade('void', 5, { voided: true })] });
    const month = buildCalendarMonth(state, derived, 2026, 9, 'en');
    expect(month.totalT).toBe(2);
    expect(month.totalP).toBeCloseTo(990 + 247.5);
    expect(month.tradeDays).toBe(2);
    expect(month.mData[4].tradeList[0].net).toBeCloseTo(247.5);
    expect(month.totalV).toBe(8000);
  });

  it('uses FIFO profit and cost when available', () => {
    const { state, derived } = buildStateFrom({ trades: [trade('fifo', 2)] });
    derived.tradeCalc.set('fifo', { ok: true, netQAR: 250, avgBuyQAR: 3.74, margin: 6.25, ppu: .25, slices: [], coveredQty: 1000, shortfallQty: 0, totalCost: 3740 });
    const month = buildCalendarMonth(state, derived, 2026, 9, 'en');
    expect(month.totalP).toBe(250);
    expect(month.mData[2].tradeList[0].avgBuy).toBe(3.74);
  });

  it('normalizes year boundaries and builds leap months correctly', () => {
    const dec = trade('dec', 31, { ts: new Date(2025, 11, 31, 12).getTime() });
    const { state, derived } = buildStateFrom({ trades: [dec] });
    expect(buildCalendarMonth(state, derived, 2026, -1, 'en').totalT).toBe(1);
    expect(Object.keys(buildCalendarMonth(state, derived, 2024, 1, 'en').mData)).toHaveLength(29);
    expect(buildCalendarMonth(state, derived, 2026, 9, 'en').winRate).toBe(0);
  });

  it('keeps payment currencies separate and excludes deleted loans', () => {
    const loan = (id: string, currency: string, amount: number) => ({ id, customerId: 'c', currency, repayments: [{ id: `p-${id}`, ts: new Date(2026, 9, 6, 12).getTime(), amount, note: '' }] });
    const { state, derived } = buildStateFrom({ customerLoans: [loan('q', 'QAR', 500), loan('e', 'EGP', 9000), loan('deleted', 'QAR', 2000)], deletedLoanIds: ['deleted'] });
    const month = buildCalendarMonth(state, derived, 2026, 9, 'en');
    expect(month.monthPayLead).toEqual({ currency: 'QAR', amount: 500, others: [{ currency: 'EGP', amount: 9000 }] });
    expect(month.totalPayCount).toBe(2);
    expect(month.mData[6].paymentCount).toBe(2);
    expect(month.tradeDays).toBe(0);
    expect(leadPayment({})).toBeNull();
  });
});
