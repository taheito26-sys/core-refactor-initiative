import { computeFIFO, totalStock, uid, type TrackerState, type Batch } from '@/lib/tracker-helpers';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import { EXCHANGE_LABELS } from '@/features/exchanges/types';

/*
 * Fixing the stock by hand for exchange records that will not be registered
 * as an order, purchase or loan. The records' combined effect on
 * (tracker − exchange) decides what the fix has to do:
 *
 *  - positive: the tracker holds more than the exchange, so batches are trimmed;
 *  - negative: the exchange holds more, so a stock batch is added;
 *  - zero: the records cancel out, so there is nothing to adjust.
 */

export type ManualFixMode = 'trim' | 'add' | 'none';

export interface ManualFixPlan {
  mode: ManualFixMode;
  /** USDT to take off (trim) or add (add); always positive. */
  amount: number;
}

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

export function planManualFix(items: Pick<PendingExchangeItem, 'effect'>[]): ManualFixPlan {
  const net = round8(items.reduce((sum, i) => sum + i.effect, 0));
  if (Math.abs(net) <= 1e-8) return { mode: 'none', amount: 0 };
  return net > 0 ? { mode: 'trim', amount: net } : { mode: 'add', amount: -net };
}

/** A short description of the records a fix covers, kept on the batch it creates. */
export function describeFixedItems(items: PendingExchangeItem[]): string {
  return items
    .map(i => `${EXCHANGE_LABELS[i.exchange]} ${i.source === 'order' ? 'P2P' : 'transfer'} ${i.reference}`)
    .join(', ');
}

/**
 * The stock batch that brings the tracker up to the exchange. It is not
 * funded from a cash account, so the merchant's cash is untouched.
 */
export function buildManualFixBatch(input: {
  amount: number;
  priceQAR: number;
  items: PendingExchangeItem[];
  note?: string;
  now?: number;
  id?: string;
}): Batch {
  const now = input.now ?? Date.now();
  const detail = describeFixedItems(input.items);
  return {
    id: input.id ?? uid(),
    ts: now,
    source: 'Manual fix',
    note: [input.note?.trim(), detail && `Fixes: ${detail}`].filter(Boolean).join(' — '),
    buyPriceQAR: input.priceQAR,
    initialUSDT: round8(input.amount),
    revisions: [],
  };
}

/** Include stock consumed by earlier uncovered sales when bringing stock up to the target. */
export function buildBalanceFixBatch(input: Parameters<typeof buildManualFixBatch>[0] & {
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'>;
  exchangeTotal: number;
}): Batch {
  const batch = buildManualFixBatch(input);
  const derived = computeFIFO([...input.state.batches, batch], input.state.trades, input.state.usdtTransfers);
  const after = totalStock(derived);
  const shortfall = [...derived.tradeCalc.values(), ...derived.transferCalc.values()]
    .reduce((sum, row) => sum + row.shortfallQty, 0);
  batch.initialUSDT = round8(batch.initialUSDT + input.exchangeTotal - after + shortfall);
  return batch;
}

/** A fix can only be confirmed when every selected reduction fits and closes the gap. */
export function canApplyBalanceReductions(target: number, reductions: Array<{ batchId: string; amount: number }>, batches: Array<{ id: string; remaining: number }>): boolean {
  const ids = new Set<string>();
  return target > 0 && reductions.length > 0 && reductions.every(r => {
    const batch = batches.find(b => b.id === r.batchId);
    if (ids.has(r.batchId)) return false;
    ids.add(r.batchId);
    return batch && Number.isFinite(r.amount) && r.amount >= 0 && r.amount <= batch.remaining;
  }) && Math.abs(target - reductions.reduce((sum, r) => sum + r.amount, 0)) <= 1e-8;
}
