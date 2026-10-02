import { describe, expect, it } from 'vitest';
import { describeRaw, normalizeReferenceQuery, searchReferences } from '@/features/exchanges/reference-search';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';
import type { TrackerState } from '@/lib/tracker-helpers';

const HASH = '0xf22c610fd71178104c2beaf8232e93a53d292aa71a4a3136122776d6840ddb7b';

const transfer = (over: Partial<ExchangeTransfer> = {}): ExchangeTransfer => ({
  id: 't1', exchange: 'binance', kind: 'network', direction: 'in', asset: 'USDT', amount: 1999, status: '1', reference: HASH,
  counterparty: '0xabc', network: 'BSC', transfer_time: '2026-09-29T10:00:00Z', linked_entity_type: null, linked_entity_id: null,
  linked_at: null, dismissed_at: null, created_at: '', ...over,
});
const order = (over: Partial<ExchangeP2POrder> = {}): ExchangeP2POrder => ({
  id: 'o1', exchange: 'binance', order_number: '22937842076092772352', side: 'sell', asset: 'USDT', fiat: 'EGP', amount: 4752.85,
  price: 52.6, total: 250000, status: 'COMPLETED', counterparty: 'ABC***', order_time: '2026-09-28T10:00:00Z',
  linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '', ...over,
});
const state = (over: Partial<TrackerState> = {}) =>
  ({ batches: [], trades: [], usdtTransfers: [], ...over }) as unknown as TrackerState;

describe('normalizeReferenceQuery', () => {
  it('trims whitespace and quotes and ignores case', () => {
    expect(normalizeReferenceQuery(`  "${HASH.toUpperCase()}" `)).toBe(HASH);
  });
});

describe('searchReferences', () => {
  it('finds a pending transfer by its hash, or by a fragment of it', () => {
    for (const query of [HASH, HASH.slice(10, 30)]) {
      const r = searchReferences({ query, orders: [], transfers: [transfer()], state: state() });
      expect(r.exchange).toHaveLength(1);
      expect(r.exchange[0]).toMatchObject({ source: 'transfer', usdt: 1999, direction: 'in', status: { kind: 'pending' } });
    }
  });

  it('still finds it when it was ignored, removed or fixed by hand, with the reason', () => {
    const r = searchReferences({
      query: HASH, orders: [], transfers: [transfer({ dismissed_at: 'x', dismiss_reason: 'adjusted', dismiss_note: 'by hand' })], state: state(),
    });
    expect(r.exchange[0].status).toEqual({ kind: 'resolved', reason: 'adjusted', note: 'by hand' });
  });

  it('reports what a registered transfer became', () => {
    const batch = { id: 'b1', ts: 1, source: 'Supplier', note: '', buyPriceQAR: 3.7, initialUSDT: 1999, revisions: [] };
    const r = searchReferences({
      query: HASH, orders: [], transfers: [transfer({ linked_at: 'x', linked_entity_id: 'b1', linked_entity_type: 'batch' })],
      state: state({ batches: [batch] as never }),
    });
    expect(r.exchange[0].status).toMatchObject({ kind: 'registered', as: 'batch', label: 'Supplier' });
  });

  it('finds an order by number with its unregistered part, and a tracker note quoting the hash', () => {
    const batch = { id: 'b1', ts: 1, source: 'Manual fix', note: `Fixes: Binance transfer ${HASH}`, buyPriceQAR: 3.7, initialUSDT: 5, revisions: [] };
    const r = searchReferences({ query: '2293784207609', orders: [order()], transfers: [], state: state() });
    expect(r.exchange[0]).toMatchObject({ source: 'order', unregisteredUsdt: 4752.85, status: { kind: 'pending' } });
    const t = searchReferences({ query: HASH, orders: [], transfers: [], state: state({ batches: [batch] as never }) });
    expect(t.tracker.map(h => h.kind)).toEqual(['batch']);
  });

  it('does not search on a query too short to be a reference', () => {
    expect(searchReferences({ query: '0xf2', orders: [], transfers: [transfer()], state: state() })).toEqual({ exchange: [], tracker: [], hiddenByScope: 0 });
  });

  it('keeps received records on the stock page and sent ones on the orders page, and says what it left out', () => {
    const inbound = transfer({ id: 'in', reference: `${HASH}a`, direction: 'in' });
    const outbound = transfer({ id: 'out', reference: `${HASH}b`, direction: 'out' });
    const stock = searchReferences({ query: HASH, orders: [], transfers: [inbound, outbound], state: state(), scope: 'stock' });
    expect(stock.exchange.map(h => h.id)).toEqual(['in']);
    expect(stock.hiddenByScope).toBe(1);
    const sent = searchReferences({ query: HASH, orders: [], transfers: [inbound, outbound], state: state(), scope: 'orders' });
    expect(sent.exchange.map(h => h.id)).toEqual(['out']);
    expect(searchReferences({ query: HASH, orders: [], transfers: [inbound, outbound], state: state() }).exchange).toHaveLength(2);
  });

  it('does not list a batch on the orders page, or an order on the stock page', () => {
    const batch = { id: 'b1', ts: 1, source: 'S', note: `tx ${HASH}`, buyPriceQAR: 3.7, initialUSDT: 5, revisions: [] };
    const trade = { id: 'tr1', ts: 1, inputMode: 'USDT', amountUSDT: 5, sellPriceQAR: 3.8, feeQAR: 0, note: `tx ${HASH}`, voided: false, usesStock: true, revisions: [], customerId: '' };
    const st = state({ batches: [batch], trades: [trade] } as never);
    expect(searchReferences({ query: HASH, orders: [], transfers: [], state: st, scope: 'stock' }).tracker.map(h => h.kind)).toEqual(['batch']);
    expect(searchReferences({ query: HASH, orders: [], transfers: [], state: st, scope: 'orders' }).tracker.map(h => h.kind)).toEqual(['trade']);
  });

  it('returns every field the exchange reported, and the batch it was registered as in full', () => {
    const batch = { id: 'b1', ts: 1, source: 'Supplier', note: 'n', buyPriceQAR: 3.7, initialUSDT: 1999, revisions: [] };
    const r = searchReferences({
      query: HASH, orders: [],
      transfers: [transfer({ raw: { txId: HASH, transactionFee: '1', insertTime: 1759140000000, empty: '', nested: { a: 1 } }, linked_at: 'x', linked_entity_id: 'b1', linked_entity_type: 'batch' })],
      state: state({ batches: [batch] as never }),
    });
    const labels = r.exchange[0].details.map(d => d.label);
    expect(labels).toEqual(['txId', 'transactionFee', 'insertTime', 'nested']);
    expect(r.exchange[0].linked?.details.find(d => d.label === 'Cost (QAR/USDT)')?.value).toBe('3.7');
    expect(describeRaw(null)).toEqual([]);
  });
});
