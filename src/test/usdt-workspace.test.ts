import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyState } from '@/lib/tracker-state';
import { computeFIFO, kpiFor, totalStock, type TrackerState } from '@/lib/tracker-helpers';
import { taggedExchangeTransferIds } from '@/lib/usdt-transfers';
import type { ExchangeBalance, ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';
import { registeredOrderAmount, trackerOrderAmounts } from '@/features/exchanges/order-coverage';
import { findPendingExchangeItems, type PendingExchangeItem } from '@/features/exchanges/reconcile';
import { buildMerchantStatements } from '@/features/stock/loan-ledger';
import { buildUsdtWorkspace, currentUsdt, linkManualMovement, manualMovementMatches, recordMerchantMovement } from '@/features/stock/usdt-workspace-model';

const start = Date.UTC(2026, 10, 4, 10); let sequence = 0;
const ids = () => `movement-${++sequence}`;
const base = (): TrackerState => ({ ...createEmptyState().state, batches: [{ id: 'old-stock', ts: Date.UTC(2026, 6, 1), initialUSDT: 30000, buyPriceQAR: 3.7, source: 'Supplier', note: '', revisions: [] }] });
const wallet = (amount: number, extra: Partial<ExchangeBalance> = {}): ExchangeBalance => ({ id: 'balance', exchange: 'binance', account_type: 'funding', asset: 'USDT', free: amount, locked: 0, updated_at: new Date(start).toISOString(), ...extra });
const transfer = (amount: number, direction: 'in' | 'out' = 'out'): ExchangeTransfer => ({ id: 'exchange-transfer', exchange: 'binance', kind: 'pay', direction, amount, asset: 'USDT', status: 'completed', reference: 'REF-10K', counterparty: 'Omar', network: null, transfer_time: new Date(start).toISOString(), linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: new Date(start).toISOString() });
const item = (amount: number, direction: 'in' | 'out' = 'out'): PendingExchangeItem => ({ key: 't:exchange-transfer', source: 'transfer', exchange: 'binance', direction, ts: start, pendingUSDT: amount, effect: direction === 'out' ? amount : -amount, counterparty: 'Omar', reference: 'REF-10K', transfer: transfer(amount, direction) });
const send = (state: TrackerState, amount: number, extra = {}) => recordMerchantMovement(state, { name: 'Omar', direction: 'out', amount, ts: start, ...extra }, ids, start).state;
const noSale = (state: TrackerState) => {
  const derived = computeFIFO(state.batches, state.trades, state.usdtTransfers);
  expect(kpiFor(state, derived, 'all')).toMatchObject({ rev: 0, net: 0, count: 0 });
  expect(state.customerLoans).toHaveLength(0);
};
beforeEach(() => { localStorage.clear(); sequence = 0; });

describe('USDT balance workspace and merchant advances', () => {
  it('shows 30k purchased, 10k with a merchant and 20k on exchanges without a mismatch or a sale', () => {
    const state = send(base(), 10000);
    const result = buildUsdtWorkspace(currentUsdt(state), state, [wallet(20000)]);
    expect(result).toMatchObject({ expected: 20000, observed: 20000, withMerchants: 10000, borrowed: 0, netOwned: 30000, difference: 0, matched: true });
    expect(state.batches).toEqual(base().batches); noSale(state);
  });
  it('handles partial and final returns at the original cost, with no duplicated stock or profit', () => {
    let state = send(base(), 10000);
    state = recordMerchantMovement(state, { name: 'Omar', direction: 'in', amount: 3000, ts: start + 60000 }, ids).state;
    expect(buildUsdtWorkspace(currentUsdt(state), state, [wallet(23000)])).toMatchObject({ expected: 23000, withMerchants: 7000, netOwned: 30000, matched: true });
    state = recordMerchantMovement(state, { name: 'Omar', direction: 'in', amount: 7000, ts: start + 120000 }, ids).state;
    expect(buildUsdtWorkspace(currentUsdt(state), state, [wallet(30000)])).toMatchObject({ expected: 30000, withMerchants: 0, borrowed: 0, netOwned: 30000, matched: true });
    const derived = computeFIFO(state.batches, state.trades, state.usdtTransfers);
    expect(derived.batches.reduce((sum, row) => sum + row.remainingUSDT * row.buyPriceQAR, 0)).toBeCloseTo(111000, 5); noSale(state);
  });
  it('separates borrowed USDT from owned USDT and supports partial repayment', () => {
    let state = recordMerchantMovement(base(), { name: 'Ali', direction: 'in', amount: 5000, ts: start }, ids).state;
    expect(buildUsdtWorkspace(currentUsdt(state), state, [wallet(35000)])).toMatchObject({ borrowed: 5000, netOwned: 30000, matched: true });
    state = recordMerchantMovement(state, { name: 'Ali', direction: 'out', amount: 2000, ts: start + 1000 }, ids).state;
    expect(buildUsdtWorkspace(currentUsdt(state), state, [wallet(33000)])).toMatchObject({ borrowed: 3000, withMerchants: 0, netOwned: 30000, matched: true }); noSale(state);
  });
  it('keeps a network fee out of the amount owed by the merchant', () => {
    const source = transfer(10001); source.kind = 'network';
    let state = send(base(), 10000, { fee: 1, source: { type: 'exchange_transfer', transfer: source } });
    expect(buildUsdtWorkspace(currentUsdt(state), state, [wallet(19999)])).toMatchObject({ withMerchants: 10000, expected: 19999, netOwned: 29999, matched: true });
    expect(taggedExchangeTransferIds(state.usdtTransfers).has(source.id)).toBe(true);
    state = recordMerchantMovement(state, { name: 'Omar', direction: 'in', amount: 10000, ts: start + 60000 }, ids).state;
    expect(currentUsdt(state)).toBe(29999); expect(buildUsdtWorkspace(currentUsdt(state), state).withMerchants).toBe(0); noSale(state);
  });
  it('requires the exchange debit to equal principal plus fee', () => {
    expect(() => send(base(), 10000, { source: { type: 'exchange_transfer', transfer: transfer(10001) } })).toThrow('Principal plus fee');
  });
  it('links an existing manual transfer without taking any more USDT out', () => {
    const state = send(base(), 10000); const movement = item(10000);
    const matches = manualMovementMatches(state, movement); expect(matches).toHaveLength(1);
    const linked = linkManualMovement(state, movement, matches[0].key);
    expect(linked.state.usdtTransfers).toHaveLength(1);
    expect(currentUsdt(linked.state)).toBe(20000);
    expect(buildUsdtWorkspace(20000, linked.state).withMerchants).toBe(10000);
    const pending = findPendingExchangeItems({ orders: [], linksByOrder: new Map(), transfers: [movement.transfer!], liveEntityIds: new Set(), importedReferences: new Set(), taggedTransferIds: taggedExchangeTransferIds(linked.state.usdtTransfers) });
    expect(pending).toHaveLength(0);
    expect(() => linkManualMovement(linked.state, movement, matches[0].key)).toThrow(); noSale(linked.state);
  });
  it('does not guess which manual movement to link when amounts repeat', () => {
    let state = send(base(), 1000); state = send(state, 1000);
    expect(manualMovementMatches(state, item(1000))).toHaveLength(2);
    expect(state.usdtTransfers?.every(row => !row.source)).toBe(true);
  });
  it('retains registration from a P2P advance even when the server split-link write fails', () => {
    const order = { id: 'order', exchange: 'okx', order_number: 'ORDER-10K', amount: 10000, side: 'sell', order_time: new Date(start).toISOString() } as ExchangeP2POrder;
    const state = send(base(), 10000, { source: { type: 'exchange_order', order, available: 10000 } });
    expect(registeredOrderAmount(order, { trackerAmounts: trackerOrderAmounts(state), linksByOrder: new Map() })).toBe(10000);
    expect(() => send(state, 10000, { source: { type: 'exchange_order', order, available: 10000 } })).toThrow('already recorded');
  });
  it('links a manual entry to a P2P order without duplicating it', () => {
    const state = send(base(), 10000);
    const order = { id: 'order', exchange: 'okx', order_number: 'ORDER-10K', amount: 10000, side: 'sell' } as ExchangeP2POrder;
    const movement: PendingExchangeItem = { ...item(10000), transfer: undefined, source: 'order', order };
    const linked = linkManualMovement(state, movement, manualMovementMatches(state, movement)[0].key);
    expect(currentUsdt(linked.state)).toBe(20000);
    expect(registeredOrderAmount(order, { trackerAmounts: trackerOrderAmounts(linked.state) })).toBe(10000);
    expect(linked.orderLinks?.[0].amount).toBe(10000);
  });
  it('preserves linked merchant identity when recording a return', () => {
    const state = send(base(), 10000, { relationshipId: 'relationship' });
    const returned = recordMerchantMovement(state, { name: 'Omar', relationshipId: 'relationship', direction: 'in', amount: 10000, ts: start + 60000 }, ids).state;
    expect(returned.usdtTransfers?.map(row => row.kind)).toEqual(['lend_out', 'lend_return']);
    expect(buildUsdtWorkspace(currentUsdt(returned), returned).withMerchants).toBe(0); expect(currentUsdt(returned)).toBe(30000);
  });
  it('keeps pre-September stock and statement history', () => {
    const state = recordMerchantMovement(base(), { name: 'Omar', direction: 'out', amount: 10000, ts: Date.UTC(2026, 7, 1) }, ids).state;
    expect(currentUsdt(state)).toBe(20000);
    expect(buildMerchantStatements(state.usdtTransfers)[0].monthGroups[0].yearMonth).toBe('2026-08');
    expect(buildMerchantStatements(state.usdtTransfers)[0].lines).toHaveLength(1);
  });
  it('does not disguise missing snapshots, invalid balances or a 1 USDT difference as a match', () => {
    expect(buildUsdtWorkspace(30000, base()).matched).toBe(false);
    expect(buildUsdtWorkspace(30000, base(), [wallet(NaN)]).observed).toBeNull();
    expect(buildUsdtWorkspace(30000, base(), [wallet(29999)]).matched).toBe(false);
    expect(buildUsdtWorkspace(30000, base(), [wallet(29999.995)]).matched).toBe(true);
  });
  it('counts only connected spot/funding wallets and includes locked USDT', () => {
    expect(buildUsdtWorkspace(30000, base(), [wallet(20000, { locked: 5000 }), wallet(5000, { account_type: 'spot' }), wallet(99999, { asset: 'BTC' }), wallet(99999, { exchange: 'okx' })], ['binance'])).toMatchObject({ observed: 30000, matched: true });
  });
  it('rejects oversending, missing names, invalid amounts and own-wallet movements', () => {
    expect(() => send(base(), 30001)).toThrow('Not enough USDT');
    expect(() => send(base(), 1000, { ts: Date.UTC(2025, 1, 1) })).toThrow('Not enough USDT');
    expect(() => send(base(), -1)).toThrow('valid amount');
    expect(() => send(base(), 1000, { name: '' })).toThrow('Choose a merchant');
    expect(() => send(base(), 1000, { source: { type: 'exchange_transfer', transfer: { ...transfer(1000), kind: 'internal' } } })).toThrow('own accounts');
  });
  it('survives serialization and does not duplicate the stock on return', () => {
    const saved = JSON.parse(JSON.stringify(send(base(), 10000))) as TrackerState;
    const restored = recordMerchantMovement(saved, { name: 'Omar', direction: 'in', amount: 10000, ts: start + 60000 }, ids).state;
    expect(totalStock(computeFIFO(restored.batches, restored.trades, restored.usdtTransfers))).toBe(30000);
    expect(restored.trades).toHaveLength(0);
  });
});
