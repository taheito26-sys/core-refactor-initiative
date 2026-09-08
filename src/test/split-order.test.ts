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

  it('never mutates the original trade object passed in', () => {
    const trade = makeTrade({ amountUSDT: 1000 });
    const frozen = JSON.parse(JSON.stringify(trade));
    splitOrder({ trade, splitAmountUsdt: 300, targetCustomerId: 'customer-b', newTradeId: 'trade-2' });
    expect(trade).toEqual(frozen);
  });
});
