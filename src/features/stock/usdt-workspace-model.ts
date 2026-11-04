import { computeFIFO, totalStock, uid, type TrackerState } from '@/lib/tracker-helpers';
import { getUsdtTransferBalances, isTransferActive, isTransferIn, taggedExchangeTransferIds } from '@/lib/usdt-transfers';
import type { ExchangeBalance, ExchangeId } from '@/features/exchanges/types';
import { exchangeOrderKey, trackerOrderAmounts } from '@/features/exchanges/order-coverage';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { applyLoanMove, loanSourceDirection, loanSourceTs, type LoanSource } from './loan-ledger';
import type { TagResult } from './usdt-tagging';

export const USDT_MATCH_TOLERANCE = 0.01;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Available FIFO already excludes money sent to merchants. Never subtract those advances twice. */
export function buildUsdtWorkspace(expected: number, state: Pick<TrackerState, 'usdtTransfers'>, balances?: ExchangeBalance[], connected?: ExchangeId[]) {
  const exchanges: Record<ExchangeId, number> = { binance: 0, okx: 0 };
  let invalid = false;
  for (const row of balances ?? []) {
    if (String(row.asset).toUpperCase() !== 'USDT' || !['spot', 'funding'].includes(row.account_type)) continue;
    if (connected && !connected.includes(row.exchange)) continue;
    const amount = Number(row.free) + Number(row.locked);
    if (Number.isFinite(amount)) exchanges[row.exchange] += amount;
    else invalid = true;
  }
  const merchants = getUsdtTransferBalances(state.usdtTransfers).map(row => ({ ...row, position: round(row.owedToMe - row.owedToThem) }));
  const withMerchants = round(merchants.reduce((sum, row) => sum + Math.max(0, row.position), 0));
  const borrowed = round(merchants.reduce((sum, row) => sum + Math.max(0, -row.position), 0));
  const observed = balances === undefined || invalid ? null : round(exchanges.binance + exchanges.okx);
  const difference = observed === null ? null : round(expected - observed);
  return { expected: round(expected), observed, difference, exchanges, merchants, withMerchants, borrowed,
    netOwned: round(expected + withMerchants - borrowed),
    matched: difference !== null && Math.abs(difference) <= USDT_MATCH_TOLERANCE };
}

export interface MerchantMovementInput {
  name: string;
  relationshipId?: string;
  direction: 'in' | 'out';
  amount: number;
  fee?: number;
  ts: number;
  source?: LoanSource;
  note?: string;
}

/** A USDT movement only: it never creates a trade, cash loan, revenue, or profit. */
export function recordMerchantMovement(state: TrackerState, input: MerchantMovementInput, newId = uid, now = Date.now()): TagResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || !/\p{L}/u.test(name)) throw new Error('Choose a merchant before recording the transfer.');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !Number.isFinite(input.ts)) throw new Error('Enter a valid amount and date.');
  const fee = Number(input.fee ?? 0);
  if (!Number.isFinite(fee) || fee < 0 || (fee > 0 && input.direction !== 'out')) throw new Error('Enter a valid outgoing network fee.');
  const source: LoanSource = input.source ?? { type: 'manual', direction: input.direction, ts: input.ts };
  if (loanSourceDirection(source) !== input.direction) throw new Error('The exchange movement has a different direction.');
  if (source.type === 'exchange_transfer') {
    if (source.transfer.kind === 'internal') throw new Error('A transfer between your own accounts is not a merchant advance.');
    if (Math.abs(input.amount + fee - Number(source.transfer.amount)) > 1e-6) throw new Error('Principal plus fee must equal the exchange movement.');
    if (taggedExchangeTransferIds(state.usdtTransfers).has(source.transfer.id)) throw new Error('This exchange movement is already recorded.');
  }
  if (source.type === 'exchange_order') {
    const covered = trackerOrderAmounts(state).get(exchangeOrderKey(source.order.exchange, source.order.order_number)) ?? 0;
    if (covered + input.amount + fee > Number(source.order.amount) + 1e-6) throw new Error('This exchange order is already recorded.');
  }
  const sourceTime = loanSourceTs(source);
  if (!Number.isFinite(sourceTime)) throw new Error('The exchange movement has no valid date. Review its source before recording it.');
  const effectiveTime = sourceTime || input.ts;
  if (input.direction === 'out') {
    const atDate = { ...state, batches: state.batches.filter(row => row.ts <= effectiveTime),
      trades: state.trades.filter(row => row.ts <= effectiveTime), usdtTransfers: state.usdtTransfers?.filter(row => row.ts <= effectiveTime) };
    if (input.amount + fee > currentUsdt(atDate) + 1e-6) throw new Error('Not enough USDT was available at this date. Check the amount or record the incoming stock first.');
  }
  const ids = new Set<string>();
  const nextId = () => { const id = newId(); ids.add(id); return id; };
  const movementSource = fee > 0 && source.type === 'exchange_transfer'
    ? { type: 'manual' as const, direction: input.direction, ts: loanSourceTs(source) } : source;
  const result = applyLoanMove(state, movementSource, name, input.amount, nextId, now, input.relationshipId);
  if (fee > 0) {
    const last = result.state.usdtTransfers?.filter(row => ids.has(row.id)).at(-1);
    if (last) {
      result.state = { ...result.state, usdtTransfers: result.state.usdtTransfers?.map(row => row.id === last.id ? { ...row, feeUSDT: fee } : row) };
      if (source.type === 'exchange_transfer') {
        const transfer = source.transfer;
        result.state = { ...result.state, usdtTransfers: result.state.usdtTransfers?.map(row => ids.has(row.id) ? { ...row,
          source: { type: 'exchange' as const, exchange: transfer.exchange, transferIds: [transfer.id], reference: transfer.reference, preDismissedIds: transfer.dismissed_at ? [transfer.id] : [] },
        } : row) };
        result.dismiss = transfer.dismissed_at ? [] : [transfer.id];
      }
      result.orderLinks = result.orderLinks?.map(link => link.entityId === last.id ? { ...link, amount: link.amount + fee } : link);
    }
  }
  if (input.note?.trim()) result.state = { ...result.state, usdtTransfers: result.state.usdtTransfers?.map(row => ids.has(row.id) ? { ...row, note: input.note!.trim() } : row) };
  const derived = computeFIFO(result.state.batches, result.state.trades, result.state.usdtTransfers);
  for (const row of result.state.usdtTransfers ?? []) {
    if (ids.has(row.id) && !isTransferIn(row) && (derived.transferCalc?.get(row.id)?.shortfallQty ?? 0) > 1e-6) {
      throw new Error('Not enough USDT was available at this date. Check the amount or record the incoming stock first.');
    }
  }
  return result;
}

/** Suggest exact manual matches; the user must explicitly link one. No amount-based auto registration. */
export function manualMovementMatches(state: Pick<TrackerState, 'usdtTransfers'>, item: PendingExchangeItem) {
  if ((!item.transfer && !item.order) || item.transfer?.kind === 'internal') return [];
  const groups = new Map<string, NonNullable<TrackerState['usdtTransfers']>>();
  for (const row of state.usdtTransfers ?? []) {
    if (!isTransferActive(row) || row.source || isTransferIn(row) !== (item.direction === 'in')) continue;
    if (item.ts && Math.abs(row.ts - item.ts) > 864e5) continue;
    const key = row.groupId ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].filter(([, rows]) => Math.abs(rows.reduce((sum, row) => sum + row.amountUSDT + (row.feeUSDT ?? 0), 0) - item.pendingUSDT) <= 1e-6)
    .map(([key, rows]) => ({ key, ids: rows.map(row => row.id), name: rows[0].counterpartyName, ts: rows[0].ts }));
}

/** Attach the feed reference to an existing movement; FIFO and merchant balances remain unchanged. */
export function linkManualMovement(state: TrackerState, item: PendingExchangeItem, key: string, now = Date.now()): TagResult {
  const match = manualMovementMatches(state, item).find(row => row.key === key);
  if (!match) throw new Error('This movement no longer matches. Refresh and review it again.');
  if (item.transfer && taggedExchangeTransferIds(state.usdtTransfers).has(item.transfer.id)) throw new Error('This exchange movement is already recorded.');
  if (item.order) {
    const order = item.order;
    const covered = trackerOrderAmounts(state).get(exchangeOrderKey(order.exchange, order.order_number)) ?? 0;
    if (covered + item.pendingUSDT > Number(order.amount) + 1e-6) throw new Error('This exchange order is already recorded.');
    const rows = (state.usdtTransfers ?? []).filter(row => match.ids.includes(row.id));
    return { state: { ...state, usdtTransfers: (state.usdtTransfers ?? []).map(row => match.ids.includes(row.id) ? { ...row, updatedAt: now,
      source: { type: 'exchange_order' as const, exchange: order.exchange, orderId: order.id, orderNumber: order.order_number, side: order.side },
    } : row) }, orderLinks: rows.map(row => ({ orderId: order.id, entityType: order.side === 'buy' ? 'batch' as const : 'trade' as const, entityId: row.id, amount: row.amountUSDT + (row.feeUSDT ?? 0), label: row.counterpartyName })) };
  }
  const transfer = item.transfer!;
  return { state: { ...state, usdtTransfers: (state.usdtTransfers ?? []).map(row => match.ids.includes(row.id) ? { ...row, updatedAt: now,
    source: { type: 'exchange' as const, exchange: transfer.exchange, transferIds: [transfer.id], reference: transfer.reference, preDismissedIds: transfer.dismissed_at ? [transfer.id] : [] },
  } : row) }, dismiss: transfer.dismissed_at ? [] : [transfer.id] };
}

export function currentUsdt(state: TrackerState) { return totalStock(computeFIFO(state.batches, state.trades, state.usdtTransfers)); }
