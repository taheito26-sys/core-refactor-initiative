import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { assertNoNewDuplicateBatches, batchPurchaseId, batchPurchaseKey } from '@/features/stock/lib/batch-identity';
import type { Batch } from '@/lib/tracker-helpers';

const batch: Batch = { id: 'a', ts: 1793455920000, source: 'ARAR ESSA', initialUSDT: 3000, buyPriceQAR: 3.68, note: '', revisions: [] };

describe('stock purchase identity', () => {
  it('blocks matching purchases and duplicates within a save', () => {
    expect(batchPurchaseKey({ ...batch, source: ' arar   essa ', note: 'retry', ts: batch.ts + 1000 })).toBe(batchPurchaseKey(batch));
    expect(() => assertNoNewDuplicateBatches([batch], [{ ...batch, id: 'b' }])).toThrow('already recorded');
    expect(() => assertNoNewDuplicateBatches([], [batch, { ...batch, id: 'b' }])).toThrow();
  });
  it('allows edits, historical records, and distinct purchases', () => {
    expect(() => assertNoNewDuplicateBatches([batch], [{ ...batch, buyPriceQAR: 4 }])).not.toThrow();
    const history = [batch, { ...batch, id: 'b' }];
    expect(() => assertNoNewDuplicateBatches(history, history)).not.toThrow();
    expect(() => assertNoNewDuplicateBatches([batch], [{ ...batch, id: 'b', ts: batch.ts + 60000 }])).not.toThrow();
  });
  it('recognizes exchange reimports while preserving supplier splits', () => {
    const imported = { ...batch, importedFrom: 'binance' as const, note: 'Imported from Binance P2P order 123' };
    expect(batchPurchaseKey({ ...imported, ts: 0, buyPriceQAR: 4 })).toBe(batchPurchaseKey(imported));
    expect(batchPurchaseKey({ ...imported, source: 'Other' })).not.toBe(batchPurchaseKey(imported));
    expect(batchPurchaseKey({ ...imported, initialUSDT: 1000 })).not.toBe(batchPurchaseKey(imported));
    expect(batchPurchaseKey({ ...imported, importedFrom: 'okx' })).not.toBe(batchPurchaseKey(imported));
  });
  it('retains creation identity after edits', () => {
    expect(() => assertNoNewDuplicateBatches([{ ...batch, purchaseKey: batchPurchaseKey(batch), buyPriceQAR: 4 }], [{ ...batch, id: 'retry' }])).toThrow();
  });
  it('reuses stock and cash IDs for retries', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    try {
      const key = batchPurchaseKey(batch);
      const id = await batchPurchaseId(key);
      expect(await batchPurchaseId(key)).toBe(id);
      expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      expect(await batchPurchaseId(key + ':funding')).not.toBe(id);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
