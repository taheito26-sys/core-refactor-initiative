import { describe, expect, it } from 'vitest';
import { auditCompletedP2POrders, localMonthOf } from '@/features/exchanges/p2p-audit';
import type { ExchangeP2POrder } from '@/features/exchanges/types';

const ts = new Date(2026, 9, 8, 12, 0).getTime();
const mk = (over: Partial<ExchangeP2POrder>): ExchangeP2POrder => ({
  id: 'o1', exchange: 'binance', order_number: '2275', side: 'sell', asset: 'USDT', fiat: 'EGP', amount: 100, price: 50, total: 5000,
  status: 'COMPLETED', counterparty: 'x', order_time: new Date(ts).toISOString(), linked_entity_type: null, linked_entity_id: null,
  linked_at: null, created_at: new Date(ts).toISOString(), ...over,
});
const base = { linksByOrder: new Map(), liveEntityIds: new Set<string>(), importedReferences: new Set<string>(), monthKey: localMonthOf(ts) };

describe('auditCompletedP2POrders', () => {
  it('flags a completed order with no trace in the tracker', () => {
    const a = auditCompletedP2POrders({ ...base, orders: [mk({})] });
    expect(a.missing).toBe(1);
    expect(a.missingUSDT).toBe(100);
  });

  it('ignores cancelled orders and other months', () => {
    const a = auditCompletedP2POrders({ ...base, orders: [mk({ id: 'c', status: 'CANCELLED' }), mk({ id: 'm', order_time: new Date(2026, 7, 1).toISOString() })] });
    expect(a.total).toBe(0);
  });

  it('counts an order as registered by live link or imported reference', () => {
    const live = auditCompletedP2POrders({
      ...base, orders: [mk({ linked_at: 'x', linked_entity_id: 't1' }), mk({ id: 'o2', order_number: '9' })],
      liveEntityIds: new Set(['t1']), importedReferences: new Set(['9']),
    });
    expect(live.registered).toBe(2);
    expect(live.missing).toBe(0);
  });

  it('a link to a deleted trade no longer counts, and a partial split is partial', () => {
    const gone = auditCompletedP2POrders({ ...base, orders: [mk({ linked_at: 'x', linked_entity_id: 'deleted' })] });
    expect(gone.missing).toBe(1);
    const links = new Map([['o1', [{ id: 'l', order_id: 'o1', entity_type: 'trade' as const, entity_id: 't1', allocated_amount: 40, customer_label: null, linked_at: '' }]]]);
    const part = auditCompletedP2POrders({ ...base, orders: [mk({})], linksByOrder: links, liveEntityIds: new Set(['t1']) });
    expect(part.partial).toBe(1);
    expect(part.missingUSDT).toBe(60);
  });

  it('reports an order ignored earlier again, so completed = registered + not registered', () => {
    const a = auditCompletedP2POrders({
      ...base,
      orders: [mk({ dismissed_at: 'now', dismiss_reason: 'ignored' }), mk({ id: 'o2', order_number: '9' })],
      importedReferences: new Set(['9']),
    });
    expect(a.ignored).toBe(1);
    expect(a.missingUSDT).toBe(100);
    expect(a.total).toBe(a.registered + a.partial + a.missing + a.ignored);
  });
});
