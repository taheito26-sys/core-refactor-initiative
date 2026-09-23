import { describe, expect, it } from 'vitest';

import { explainReconciliationDelta, findPendingExchangeItems } from '@/features/exchanges/reconcile';
import type { ExchangeOrderLink } from '@/features/exchanges/hooks/useExchangeOrderLinks';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';

function order(id: string, side: 'buy' | 'sell', amount: number, overrides: Partial<ExchangeP2POrder> = {}): ExchangeP2POrder {
  return {
    id, exchange: 'binance', order_number: `N${id}`, side, asset: 'USDT', fiat: 'QAR', amount, price: 3.69,
    total: amount * 3.69, status: 'completed', counterparty: 'buyer', order_time: '2026-09-23T10:00:00Z',
    linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '', ...overrides,
  };
}

function transfer(id: string, direction: 'in' | 'out', amount: number, overrides: Partial<ExchangeTransfer> = {}): ExchangeTransfer {
  return {
    id, exchange: 'binance', kind: 'pay', direction, asset: 'USDT', amount, status: 'ok', reference: `R${id}`,
    counterparty: 'm', network: null, transfer_time: '2026-09-22T10:00:00Z', linked_entity_type: null,
    linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '', ...overrides,
  };
}

const link = (orderId: string, entityId: string, amount: number): ExchangeOrderLink =>
  ({ id: `${orderId}-${entityId}`, order_id: orderId, entity_type: 'trade', entity_id: entityId, allocated_amount: amount, customer_label: null, linked_at: '' });

const base = { liveEntityIds: new Set(['live-trade', 'live-batch']), importedReferences: new Set<string>(), linksByOrder: new Map() };

describe('explaining a tracker vs. exchange mismatch', () => {
  it('attributes the whole delta to an unregistered sell order (tracker +4,397)', () => {
    const items = findPendingExchangeItems({ ...base, orders: [order('new', 'sell', 4397)], transfers: [] });
    const e = explainReconciliationDelta(4397, items);
    expect(e.explained).toBe(4397);
    expect(e.remaining).toBe(0);
    expect(e.fullyExplained).toBe(true);
  });

  it('reports what is left after registering when the order does not cover it all', () => {
    const items = findPendingExchangeItems({ ...base, orders: [order('new', 'sell', 3000)], transfers: [] });
    const e = explainReconciliationDelta(4397, items);
    expect(e.fullyExplained).toBe(false);
    expect(e.remaining).toBe(1397);
  });

  it('nets sells against buys and transfers in both directions', () => {
    const items = findPendingExchangeItems({
      ...base,
      orders: [order('s', 'sell', 5000), order('b', 'buy', 2000)],
      transfers: [transfer('out', 'out', 1000), transfer('in', 'in', 500)],
    });
    expect(explainReconciliationDelta(0, items).explained).toBe(5000 - 2000 + 1000 - 500);
  });

  it('skips what is already registered, dismissed or tagged, and counts only the unregistered part of a split order', () => {
    const items = findPendingExchangeItems({
      ...base,
      orders: [
        order('full', 'sell', 1000, { linked_at: 'x', linked_entity_id: 'live-trade' }),
        order('byref', 'sell', 1000, { order_number: 'REF1' }),
        order('split', 'sell', 10000),
        order('deadlink', 'sell', 700, { linked_at: 'x', linked_entity_id: 'deleted-trade' }),
      ],
      linksByOrder: new Map([['split', [link('split', 'live-trade', 6000), link('split', 'deleted', 1000)]]]),
      importedReferences: new Set(['REF1']),
      transfers: [
        transfer('dismissed', 'out', 900, { dismissed_at: 'x' }),
        transfer('tagged', 'out', 800),
        transfer('linked', 'in', 600, { linked_at: 'x', linked_entity_id: 'live-batch' }),
        transfer('pending', 'in', 400),
      ],
      taggedTransferIds: new Set(['tagged']),
    });
    const byKey = Object.fromEntries(items.map(i => [i.key, i.effect]));
    expect(byKey).toEqual({ 'o:split': 4000, 'o:deadlink': 700, 't:pending': -400 });
  });

  it('tolerates a network withdrawal fee but not a real gap', () => {
    const items = findPendingExchangeItems({ ...base, orders: [], transfers: [transfer('net', 'out', 10999.9)] });
    expect(explainReconciliationDelta(11000.9, items).fullyExplained).toBe(true);
    expect(explainReconciliationDelta(11050, items).fullyExplained).toBe(false);
  });

  it('never claims to explain a delta when nothing is pending', () => {
    const e = explainReconciliationDelta(0.5, []);
    expect(e.fullyExplained).toBe(false);
    expect(e.remaining).toBe(0.5);
  });
});
