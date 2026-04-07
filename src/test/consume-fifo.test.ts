import { describe, expect, it } from 'vitest';

import { canSubmitWithStockCoverage, computeStockCoverage } from '@/features/orders/utils/sale-draft';
import { consumeFifo, type StockLayer } from '@/lib/tracker-helpers';

const layers: StockLayer[] = [
  { id: 'l1', ts: 1, remainingQty: 100, buyPrice: 3.5 },
  { id: 'l2', ts: 2, remainingQty: 60, buyPrice: 3.7 },
  { id: 'l3', ts: 3, remainingQty: 80, buyPrice: 3.9 },
];

describe('consumeFifo', () => {
  it('enough stock: consumes oldest layers first', () => {
    const result = consumeFifo(layers, 120);
    expect(result.shortfallQty).toBe(0);
    expect(result.coveredQty).toBe(120);
    expect(result.consumed).toEqual([
      { layerId: 'l1', qty: 100, buyPrice: 3.5, cost: 350 },
      { layerId: 'l2', qty: 20, buyPrice: 3.7, cost: 74 },
    ]);
    expect(result.totalCost).toBe(424);
  });

  it('exact stock match: covers fully and preserves FIFO sequence', () => {
    const result = consumeFifo(layers, 240);
    expect(result.coveredQty).toBe(240);
    expect(result.shortfallQty).toBe(0);
    expect(result.consumed).toHaveLength(3);
    expect(result.consumed[2]).toEqual({ layerId: 'l3', qty: 80, buyPrice: 3.9, cost: 312 });
  });

  it('partial consumption across multiple layers reports uncovered quantity', () => {
    const result = consumeFifo(layers, 260);
    expect(result.coveredQty).toBe(240);
    expect(result.shortfallQty).toBe(20);
    expect(result.totalCost).toBeCloseTo(884, 8);
  });
});

describe('insufficient stock submit policy', () => {
  it('blocks submit without override', () => {
    const coverage = computeStockCoverage(240, 260);
    expect(canSubmitWithStockCoverage(coverage, true, false, false)).toBe(false);
  });

  it('allows submit with explicit override confirmation', () => {
    const coverage = computeStockCoverage(240, 260);
    expect(canSubmitWithStockCoverage(coverage, true, true, true)).toBe(true);
  });
});

