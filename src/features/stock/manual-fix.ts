import { uid, type Batch } from '@/lib/tracker-helpers';
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
  if (Math.abs(net) < 0.005) return { mode: 'none', amount: 0 };
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
