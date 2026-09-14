// ─── Order Split Tests ───────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { splitOrder, validateSplitOrder } from '@/lib/trading/split-order';
import type { Trade } from '@/lib/tracker-helpers';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    ts: 1700000000000,
    inputMode: 'USDT',
    amountUSDT: 1000,
    sellPriceQAR: 3.8,
    feeQAR: 0,
    note: '',
    voided: false,
    usesStock: true,
    revisions: [],
    customerId: 'customer-a',
    ...overrides,
  };
}

describe('validateSplitOrder', () => {
  it('rejects a zero or negative split amount', () => {
    expect(validateSplitOrder(0, 1000, 'customer-b')).toBe('invalid_amount');
    expect(validateSplitOrder(-5, 1000, 'customer-b')).toBe('invalid_amount');
  });

  it('rejects a split amount equal to or greater than the total', () => {
    expect(validateSplitOrder(1000, 1000, 'customer-b')).toBe('amount_too_large');
    expect(validateSplitOrder(1200, 1000, 'customer-b')).toBe('amount_too_large');
  });

  it('rejects a missing target customer', () => {
    expect(validateSplitOrder(300, 1000, '')).toBe('no_target_customer');
  });

  it('passes for a valid partial split', () => {
    expect(validateSplitOrder(300, 1000, 'customer-b')).toBeNull();
  });
});

describe('splitOrder', () => {
  it('carves the split amount into a new trade under the target customer, leaving the remainder on the original', () => {
    const trade = makeTrade({ amountUSDT: 1000 });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(primaryTrade.id).toBe('trade-1');
    expect(primaryTrade.amountUSDT).toBe(700);
    expect(primaryTrade.customerId).toBe('customer-a');

    expect(secondTrade.id).toBe('trade-2');
    expect(secondTrade.amountUSDT).toBe(300);
    expect(secondTrade.customerId).toBe('customer-b');

    // The two halves must always sum back to the original total -- this is
    // the one invariant a split can never violate.
    expect(primaryTrade.amountUSDT + secondTrade.amountUSDT).toBe(trade.amountUSDT);
  });

  it('rounds to 8 decimal places so a non-terminating remainder does not carry floating-point dust', () => {
    const trade = makeTrade({ amountUSDT: 10 });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 3.33333333,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(primaryTrade.amountUSDT).toBe(6.66666667);
    expect(secondTrade.amountUSDT).toBe(3.33333333);
  });

  it('copies every other field from the original trade onto the new one (rate, date, stock flag, fee)', () => {
    const trade = makeTrade({
      ts: 1712345678000,
      sellPriceQAR: 3.91,
      feeQAR: 12,
      usesStock: false,
      manualBuyPrice: 3.6,
    });
    const { secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 250,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(secondTrade.ts).toBe(trade.ts);
    expect(secondTrade.sellPriceQAR).toBe(trade.sellPriceQAR);
    expect(secondTrade.feeQAR).toBe(trade.feeQAR);
    expect(secondTrade.usesStock).toBe(trade.usesStock);
    expect(secondTrade.manualBuyPrice).toBe(trade.manualBuyPrice);
  });

  it('preserves an existing exchange import stamp on both halves, so an imported Binance order stays traceable after being split', () => {
    const trade = makeTrade({
      importedFrom: 'binance',
      originalFiat: 'EGP',
      originalFiatAmount: 50000,
      originalFiatPriceUSDT: 51.2,
      exchangeOrderNumber: '12345',
      exchangeCounterparty: 'Abc***',
    });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 400,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    for (const half of [primaryTrade, secondTrade]) {
      expect(half.importedFrom).toBe('binance');
      expect(half.exchangeOrderNumber).toBe('12345');
      expect(half.exchangeCounterparty).toBe('Abc***');
    }
  });

  it('appends a split note to the remainder and a distinct note to the new trade when the original had no note', () => {
    const trade = makeTrade({ note: '' });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(primaryTrade.note).toContain('Split off 300 USDT to another customer');
    expect(secondTrade.note).toBe('Split from original order');
  });

  it('appends to an existing note rather than replacing it', () => {
    const trade = makeTrade({ note: 'Imported from Binance P2P order 999' });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(primaryTrade.note).toBe('Imported from Binance P2P order 999 — split: 300 USDT moved to another customer');
    expect(secondTrade.note).toBe('Imported from Binance P2P order 999 (split from original order)');
  });

  it('records a revision history entry on the remainder when splitting an existing (edited) order', () => {
    const trade = makeTrade({ revisions: [] });
    const { primaryTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      atRegistration: false,
    });

    expect(primaryTrade.revisions).toHaveLength(1);
    expect(primaryTrade.revisions[0].before.amountUSDT).toBe(trade.amountUSDT);
  });

  it('does not record a revision history entry when splitting a sale being registered for the first time', () => {
    const trade = makeTrade({ revisions: [] });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      atRegistration: true,
    });

    expect(primaryTrade.revisions).toHaveLength(0);
    expect(secondTrade.revisions).toHaveLength(0);
  });

  it('throws rather than silently producing a nonsensical split when validation would fail', () => {
    const trade = makeTrade({ amountUSDT: 100 });
    expect(() => splitOrder({
      trade, splitAmountUsdt: 0, targetCustomerId: 'customer-b', newTradeId: 'trade-2',
    })).toThrow();
    expect(() => splitOrder({
      trade, splitAmountUsdt: 150, targetCustomerId: 'customer-b', newTradeId: 'trade-2',
    })).toThrow();
    expect(() => splitOrder({
      trade, splitAmountUsdt: 50, targetCustomerId: '', newTradeId: 'trade-2',
    })).toThrow();
  });

  it('gives the split-off trade its own sell price when one is provided', () => {
    const trade = makeTrade({ amountUSDT: 1000, sellPriceQAR: 3.8 });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      secondSellPriceQAR: 4.1,
    });

    expect(primaryTrade.sellPriceQAR).toBe(3.8);
    expect(secondTrade.sellPriceQAR).toBe(4.1);
  });

  it('falls back to the original rate for the split-off trade when no separate price is given', () => {
    const trade = makeTrade({ sellPriceQAR: 3.8 });
    const { secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 300,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
    });

    expect(secondTrade.sellPriceQAR).toBe(3.8);
  });

  it('regression: splits against the true original total, not an already-reduced remainder', () => {
    // Reproduces a real production incident: the New Sale form's quantity
    // field is two-way mirrored against "Amount to move" as the merchant
    // types, so by the time the order is registered that field already
    // shows the post-split remainder (3882), not the whole imported order
    // (4479.66). Calling splitOrder with that already-reduced number as
    // `trade.amountUSDT` silently subtracts the split amount a second time
    // (3882 - 597.66 = 3284.34, not 3882) -- callers must always pass the
    // true pre-split total (the anchor captured when Split was checked),
    // never whatever the quantity input currently displays.
    const trade = makeTrade({ amountUSDT: 4479.66 });
    const { primaryTrade, secondTrade } = splitOrder({
      trade,
      splitAmountUsdt: 597.66,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      atRegistration: true,
    });

    expect(primaryTrade.amountUSDT).toBe(3882);
    expect(secondTrade.amountUSDT).toBe(597.66);
    expect(primaryTrade.amountUSDT + secondTrade.amountUSDT).toBe(4479.66);
  });

  it('regression: a stale anchor from a previously-loaded order must never leak into a freshly-picked one', () => {
    // Reproduces a second, distinct production incident (separate from the
    // one above): the merchant had an earlier draft in Price+Vol/QAR mode
    // (Amount 14713 QAR @ 3.79 -> 3882.058047493403 USDT), checked Split
    // there, then clicked "Edit" on a different imported Binance order
    // (4479.66 USDT) without ever unchecking Split. The New Sale form's
    // prefill handlers overwrote the visible total with 4479.66 but never
    // reset the split anchor, which stayed pinned to the old draft's
    // 3882.058047493403. Typing 600 into "Amount to move" then computed
    // 3882.058047493403 - 600 = 3282.058047493403 -- the exact wrong value
    // seen in production -- instead of 4479.66 - 600 = 3879.66. The fix is
    // in OrdersPage.tsx (applyExchangeOrderPrefill / applyExchangeTransferPrefill
    // now reset newSaleSplitOpen/Amount/CustomerId/SellPrice/AnchorTotal on
    // every prefill); this test pins the correct math splitOrder() must
    // produce once the anchor is the real, current order total.
    const staleAnchorResult = splitOrder({
      trade: makeTrade({ amountUSDT: 3882.058047493403 }),
      splitAmountUsdt: 600,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      atRegistration: true,
    });
    expect(staleAnchorResult.primaryTrade.amountUSDT).toBeCloseTo(3282.058047493403, 6);

    const correctAnchorResult = splitOrder({
      trade: makeTrade({ amountUSDT: 4479.66 }),
      splitAmountUsdt: 600,
      targetCustomerId: 'customer-b',
      newTradeId: 'trade-2',
      atRegistration: true,
      secondSellPriceQAR: 3.85,
    });
    expect(correctAnchorResult.primaryTrade.amountUSDT).toBe(3879.66);
    expect(correctAnchorResult.secondTrade.amountUSDT).toBe(600);
    expect(correctAnchorResult.primaryTrade.amountUSDT + correctAnchorResult.secondTrade.amountUSDT).toBe(4479.66);
    expect(correctAnchorResult.secondTrade.sellPriceQAR).toBe(3.85);
    expect(correctAnchorResult.secondTrade.amountUSDT * correctAnchorResult.secondTrade.sellPriceQAR).toBe(2310);
  });

  it('changing the split sell price only changes the fiat value, never the USDT quantities', () => {
    const trade = makeTrade({ amountUSDT: 4479.66, sellPriceQAR: 3.79 });
    const at385 = splitOrder({
      trade, splitAmountUsdt: 600, targetCustomerId: 'customer-b', newTradeId: 'trade-2', secondSellPriceQAR: 3.85,
    });
    const at400 = splitOrder({
      trade, splitAmountUsdt: 600, targetCustomerId: 'customer-b', newTradeId: 'trade-2', secondSellPriceQAR: 4.00,
    });

    expect(at385.primaryTrade.amountUSDT).toBe(at400.primaryTrade.amountUSDT);
    expect(at385.secondTrade.amountUSDT).toBe(at400.secondTrade.amountUSDT);
    expect(at385.secondTrade.amountUSDT * at385.secondTrade.sellPriceQAR).toBe(2310);
    expect(at400.secondTrade.amountUSDT * at400.secondTrade.sellPriceQAR).toBe(2400);
  });

  it('never mutates the original trade object passed in', () => {
    const trade = makeTrade({ amountUSDT: 1000 });
    const frozen = JSON.parse(JSON.stringify(trade));
    splitOrder({ trade, splitAmountUsdt: 300, targetCustomerId: 'customer-b', newTradeId: 'trade-2' });
    expect(trade).toEqual(frozen);
  });
});
