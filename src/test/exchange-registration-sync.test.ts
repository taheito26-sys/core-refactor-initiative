import { describe, expect, it } from 'vitest';
import { mergeLocalAndCloud } from '@/lib/tracker-state';
import { mergeTrackerStatesForMerchant } from '@/lib/tracker-sync';
import { trackerOrderAmounts, exchangeOrderKey } from '@/features/exchanges/order-coverage';
import type { Trade } from '@/lib/tracker-helpers';

const saved = { id: 'saved', amountUSDT: 1064, importedFrom: 'okx', exchangeOrderNumber: 'okx-123', note: 'original', voided: false } as Trade;
const stale = { id: 'saved', amountUSDT: 1064, note: 'edited', voided: false } as Trade;

describe('exchange registration across snapshot merges', () => {
  it('keeps registration on reload when cloud has an older same-id row without source metadata', () => {
    const merged = mergeLocalAndCloud({ trades: [saved] }, { trades: [stale] });
    expect(trackerOrderAmounts({ trades: merged!.trades!, batches: [] }).get(exchangeOrderKey('okx', 'okx-123'))).toBe(1064);
  });
  it('keeps registration when another team snapshot lacks metadata while retaining its quantity correction', () => {
    const merged = mergeTrackerStatesForMerchant([
      { state: { trades: [saved] }, updated_at: '2026-11-01T01:00:00Z' },
      { state: { trades: [{ ...stale, amountUSDT: 1000 }] }, updated_at: '2026-11-01T02:00:00Z' },
    ]);
    expect(trackerOrderAmounts({ trades: merged!.trades!, batches: [] }).get(exchangeOrderKey('okx', 'okx-123'))).toBe(1000);
  });
  it('recovers an existing registration from its exact revision reference after the note was edited', () => {
    const edited = { ...stale, revisions: [{ before: { note: 'Imported from OKX P2P order okx-123 — old note' } }] };
    expect(trackerOrderAmounts({ trades: [edited], batches: [] }).get(exchangeOrderKey('okx', 'okx-123'))).toBe(1064);
  });
  it('does not guess from conflicting historical references or revive a voided order', () => {
    const edited = { ...stale, revisions: ['one', 'two'].map(reference => ({ before: { note: `Imported from OKX P2P order ${reference} — old note` } })) };
    expect(trackerOrderAmounts({ trades: [edited], batches: [] }).size).toBe(0);
    expect(trackerOrderAmounts({ trades: [{ ...saved, voided: true }], batches: [] }).size).toBe(0);
  });

});
