import { describe, expect, it } from 'vitest';
import {
  aggregateLiquidityOverview,
  buildLiquidityActions,
  computePublishedExact,
  computePublishedRange,
  filterLiquidityEntries,
  isLiquidityStale,
  rankLiquidityEntries,
  type LiquidityBoardEntry,
} from '@/features/merchants/liquidity/liquidity-model';

const baseEntry = (overrides: Partial<LiquidityBoardEntry>): LiquidityBoardEntry => ({
  merchantId: 'M-1',
  relationshipId: 'rel-1',
  merchantName: 'Alpha',
  relationshipStatus: 'active',
  region: 'Doha',
  cash: { enabled: true, mode: 'exact', exactAmount: 100000, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 },
  usdt: { enabled: true, mode: 'exact', exactAmount: 25000, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 },
  updatedAt: new Date('2026-03-28T10:00:00.000Z').toISOString(),
  expiresAt: null,
  isStale: false,
  ...overrides,
});

describe('merchant liquidity publishing', () => {
  it('supports publishing cash only', () => {
    const entry = baseEntry({ usdt: { enabled: false, mode: 'status', exactAmount: null, rangeMin: null, rangeMax: null, status: 'unavailable', reserveBuffer: 0 } });
    expect(entry.cash.enabled).toBe(true);
    expect(entry.usdt.enabled).toBe(false);
  });

  it('supports publishing USDT only', () => {
    const entry = baseEntry({ cash: { enabled: false, mode: 'status', exactAmount: null, rangeMin: null, rangeMax: null, status: 'unavailable', reserveBuffer: 0 } });
    expect(entry.cash.enabled).toBe(false);
    expect(entry.usdt.enabled).toBe(true);
  });

  it('supports publishing both sides', () => {
    const entry = baseEntry({});
    expect(entry.cash.enabled).toBe(true);
    expect(entry.usdt.enabled).toBe(true);
  });

  it('exact mode applies reserve and commitments', () => {
    const visible = computePublishedExact({ exactAmount: 150000, reserveBuffer: 10000, internalAvailable: 140000, reservedCommitments: 15000 });
    expect(visible).toBe(115000);
  });

  it('range mode clamps and preserves min/max', () => {
    const visible = computePublishedRange({ minAmount: 50000, maxAmount: 100000, reserveBuffer: 10000, internalAvailable: 90000, reservedCommitments: 5000 });
    expect(visible).toEqual({ min: 35000, max: 75000 });
  });

  it('status-only mode can be filtered', () => {
    const entries = [
      baseEntry({ merchantId: 'A', cash: { enabled: true, mode: 'status', exactAmount: null, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 } }),
      baseEntry({ merchantId: 'B', cash: { enabled: true, mode: 'status', exactAmount: null, rangeMin: null, rangeMax: null, status: 'unavailable', reserveBuffer: 0 } }),
    ];

    const filtered = filterLiquidityEntries(entries, { side: 'cash', minAmount: 1, relationship: 'all', updatedRecentlyHours: null });
    expect(filtered.map((e) => e.merchantId)).toEqual(['A']);
  });

  it('stale entries are recognized', () => {
    expect(isLiquidityStale('2026-03-25T00:00:00.000Z', null, new Date('2026-03-28T12:00:00.000Z').getTime())).toBe(true);
    expect(isLiquidityStale('2026-03-28T10:00:00.000Z', '2026-03-28T09:00:00.000Z', new Date('2026-03-28T12:00:00.000Z').getTime())).toBe(true);
  });

  it('board totals aggregate active liquidity correctly', () => {
    const overview = aggregateLiquidityOverview([
      baseEntry({ merchantId: 'A', cash: { enabled: true, mode: 'exact', exactAmount: 100, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 }, usdt: { enabled: true, mode: 'range', exactAmount: null, rangeMin: 20, rangeMax: 30, status: 'available', reserveBuffer: 0 } }),
      baseEntry({ merchantId: 'B', cash: { enabled: true, mode: 'range', exactAmount: null, rangeMin: 50, rangeMax: 70, status: 'limited', reserveBuffer: 0 }, usdt: { enabled: true, mode: 'exact', exactAmount: 10, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 } }),
    ], new Date('2026-03-28T12:00:00.000Z').getTime());

    expect(overview.totalCashAvailable).toBe(150);
    expect(overview.totalUsdtAvailable).toBe(30);
    expect(overview.activeMerchantsCount).toBe(2);
  });

  it('matching ranks sufficient active relationships first', () => {
    const ranked = rankLiquidityEntries([
      baseEntry({ merchantId: 'A', relationshipStatus: 'pending', cash: { enabled: true, mode: 'exact', exactAmount: 65000, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 } }),
      baseEntry({ merchantId: 'B', relationshipStatus: 'active', cash: { enabled: true, mode: 'exact', exactAmount: 70000, rangeMin: null, rangeMax: null, status: 'available', reserveBuffer: 0 } }),
      baseEntry({ merchantId: 'C', relationshipStatus: 'active', cash: { enabled: true, mode: 'exact', exactAmount: 10000, rangeMin: null, rangeMax: null, status: 'limited', reserveBuffer: 0 } }),
    ], 'cash', 60000);

    expect(ranked.map((e) => e.merchantId)).toEqual(['B', 'A', 'C']);
  });

  it('board actions map into merchant workflows', () => {
    const actions = buildLiquidityActions('rel-555');
    expect(actions.workspacePath).toBe('/merchants/rel-555');
    expect(actions.chatPath).toBe('/trading/merchants?tab=chat&relationship=rel-555');
    expect(actions.dealPath).toBe('/trading/orders?relationship=rel-555');
  });
});
