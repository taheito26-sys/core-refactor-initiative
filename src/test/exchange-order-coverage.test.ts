import { describe, expect, it } from 'vitest';
import { trackerOrderAmounts, registeredOrderAmount } from '@/features/exchanges/order-coverage';
import { auditCompletedP2POrders } from '@/features/exchanges/p2p-audit';
import { findPendingExchangeItems } from '@/features/exchanges/reconcile';
import type { Batch, Trade } from '@/lib/tracker-helpers';
import type { ExchangeP2POrder } from '@/features/exchanges/types';

const order = (id: string, amount: number): ExchangeP2POrder => ({ id, exchange: 'okx', order_number: id, side: 'sell', asset: 'USDT', amount, price: 0, total: 0, fiat: 'EGP', status: 'completed', order_time: '2026-11-01T02:00:00Z', linked_at: null, linked_entity_id: null, linked_entity_type: null, counterparty: null, created_at: '' });
const trade = (id: string, amountUSDT: number, exchangeOrderNumber = 'bill-1'): Trade => ({ id, amountUSDT, importedFrom: 'okx', exchangeOrderNumber, note: '', voided: false } as Trade);

describe('durable exchange order coverage', () => {
  it('keeps both saved OKX orders registered after note edits, a reload, or missing server links', () => {
    const trades = [trade('saved-a', 1064.5), trade('saved-b', 1785.5, 'bill-2')];
    const input = { orders: [order('bill-1', 1064.5), order('bill-2', 1785.5)].map((o, i) => ({ ...o, id: `refreshed-row-${i}` })), linksByOrder: new Map(), liveEntityIds: new Set(trades.map(t => t.id)), importedReferences: new Set<string>(), trackerAmounts: trackerOrderAmounts({ trades, batches: [] }), monthKey: '2026-11' };
    const audit = auditCompletedP2POrders(input);
    expect(audit.registered).toBe(2);
    expect(audit.missing + audit.partial).toBe(0);
    expect(findPendingExchangeItems({ ...input, transfers: [] })).toEqual([]);
  });
  it('sums split shares once per live entity and keeps a deleted share available for registration', () => {
    const a = trade('a', 25), b = trade('b', 75);
    const full = trackerOrderAmounts({ trades: [a, b, a], batches: [] });
    expect(registeredOrderAmount(order('bill-1', 100), { trackerAmounts: full })).toBe(100);
    const partial = trackerOrderAmounts({ trades: [a, { ...b, voided: true }], batches: [] });
    expect(registeredOrderAmount(order('bill-1', 100), { trackerAmounts: partial })).toBe(25);
  });
  it('uses current tracker quantities instead of stale allocation amounts or a full-note boolean', () => {
    const saved = trade('a', 40);
    const input = { orders: [order('bill-1', 100)], trackerAmounts: trackerOrderAmounts({ trades: [saved], batches: [] }), importedReferences: new Set(['bill-1']), liveEntityIds: new Set(['a']), linksByOrder: new Map([['bill-1', [{ id: 'link', order_id: 'bill-1', entity_type: 'trade' as const, entity_id: 'a', allocated_amount: 100, customer_label: null, linked_at: '' }]]]), monthKey: 'all' };
    expect(auditCompletedP2POrders(input).partial).toBe(1);
    expect(auditCompletedP2POrders(input).missingUSDT).toBe(60);
    expect(findPendingExchangeItems({ ...input, transfers: [] })[0].pendingUSDT).toBe(60);
  });
  it('does not confuse the same reference from different exchanges', () => {
    const amounts = trackerOrderAmounts({ trades: [trade('a', 100)], batches: [] });
    expect(registeredOrderAmount({ ...order('bill-1', 100), exchange: 'binance' }, { trackerAmounts: amounts, importedReferences: new Set(['bill-1']) })).toBe(0);
  });
  it('supports older note-only records and stable batch identities', () => {
    const old = { ...trade('old', 30), exchangeOrderNumber: undefined, note: 'Imported from OKX P2P order bill-1 — old record' };
    const batch = { id: 'batch', initialUSDT: 70, importedFrom: 'okx', exchangeOrderNumber: 'bill-1', note: 'edited note' } as Batch;
    expect(registeredOrderAmount(order('bill-1', 100), { trackerAmounts: trackerOrderAmounts({ trades: [old], batches: [batch] }) })).toBe(100);
  });
  it('does not hide a genuinely missing or voided order', () => {
    const amounts = trackerOrderAmounts({ trades: [{ ...trade('a', 100), voided: true }], batches: [] });
    expect(registeredOrderAmount(order('bill-1', 100), { trackerAmounts: amounts })).toBe(0);
    expect(registeredOrderAmount(order('different', 100), { trackerAmounts: amounts })).toBe(0);
  });
});
