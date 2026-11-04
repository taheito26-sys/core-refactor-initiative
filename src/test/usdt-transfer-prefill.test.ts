import { beforeEach, describe, expect, it } from 'vitest';
import { consumeSaleTransferPrefill, stashSaleTransferPrefill } from '@/features/exchanges/tracker-import';
import type { ExchangeTransferPayload } from '@/features/exchanges/components/ExchangeInbox';

describe('exchange transfer sale prefill', () => {
  beforeEach(() => sessionStorage.clear());
  it('preserves the exact exchange reference across navigation and consumes it once', () => {
    const payload: ExchangeTransferPayload = { exchange: 'binance', transferId: 'transfer-exact-id', transferIds: ['transfer-exact-id'], buyPrice: 0, amountUSDT: 1234.56, reference: 'reference-exact', ts: Date.now(), kind: 'network' };
    stashSaleTransferPrefill(payload);
    expect(consumeSaleTransferPrefill()).toEqual(payload);
    expect(consumeSaleTransferPrefill()).toBeNull();
  });
  it.each(['{', '{}', '{"transferIds":[],"amountUSDT":10}', '{"transferIds":["id"],"amountUSDT":0}'])('discards an invalid prefill: %s', raw => {
    sessionStorage.setItem('sale-transfer-prefill', raw);
    expect(consumeSaleTransferPrefill()).toBeNull();
    expect(sessionStorage.getItem('sale-transfer-prefill')).toBeNull();
  });
});
