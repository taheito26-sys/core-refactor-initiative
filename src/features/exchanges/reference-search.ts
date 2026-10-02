import type { TrackerState } from '@/lib/tracker-helpers';
import { extractImportedReference } from './tracker-import';
import { sumLinkedAmount, type ExchangeOrderLink } from './hooks/useExchangeOrderLinks';
import type { ExchangeDismissReason, ExchangeId, ExchangeP2POrder, ExchangeTransfer } from './types';

// ─── Finding one transaction by its hash or order number ───
//
// A merchant often has only a transaction hash or an order number in hand.
// This looks it up across everything the tracker knows, whatever state the
// record is in: pending in the exchange inbox, registered as a batch / trade
// / merchant loan, or resolved without registering (ignored, removed, fixed
// by hand). It never hides a record because it was dealt with.

/** Shorter queries match too much to be a useful reference. */
export const MIN_REFERENCE_QUERY = 6;

/** Trims whitespace and surrounding quotes so a pasted hash matches. */
export function normalizeReferenceQuery(raw: string): string {
  return String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim().toLowerCase();
}

export type ReferenceStatus =
  | { kind: 'pending' }
  | { kind: 'resolved'; reason: ExchangeDismissReason; note: string | null }
  | { kind: 'registered'; as: 'batch' | 'trade' | 'loan' | 'imported'; label: string };

export interface ExchangeReferenceHit {
  key: string;
  source: 'order' | 'transfer';
  id: string;
  exchange: ExchangeId;
  direction: 'in' | 'out';
  usdt: number;
  ts: number;
  reference: string;
  counterparty: string | null;
  network: string | null;
  exchangeStatus: string;
  price?: number;
  fiat?: string;
  /** USDT of the record still not registered anywhere (orders only; 0 for a transfer). */
  unregisteredUsdt: number;
  status: ReferenceStatus;
}

export interface TrackerReferenceHit {
  key: string;
  kind: 'batch' | 'trade' | 'loan';
  id: string;
  ts: number;
  amountUSDT: number;
  label: string;
  note: string;
}

export interface ReferenceSearchResult {
  exchange: ExchangeReferenceHit[];
  tracker: TrackerReferenceHit[];
}

const contains = (haystack: string | null | undefined, needle: string) =>
  !!haystack && String(haystack).toLowerCase().includes(needle);

export function searchReferences(input: {
  query: string;
  orders: ExchangeP2POrder[] | undefined;
  transfers: ExchangeTransfer[] | undefined;
  linksByOrder?: Map<string, ExchangeOrderLink[]>;
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'>;
}): ReferenceSearchResult {
  const q = normalizeReferenceQuery(input.query);
  if (q.length < MIN_REFERENCE_QUERY) return { exchange: [], tracker: [] };

  const batches = input.state.batches || [];
  const trades = input.state.trades || [];
  const loans = input.state.usdtTransfers || [];
  const liveTrades = trades.filter(tr => !tr.voided || tr.usdtTransferKind);
  const liveLoans = loans.filter(l => !l.voided);
  const liveIds = new Set<string>([...batches.map(b => b.id), ...liveTrades.map(tr => tr.id), ...liveLoans.map(l => l.id)]);
  const importedRefs = new Set<string>(
    [...batches.map(b => extractImportedReference(b.note)), ...liveTrades.map(tr => extractImportedReference(tr.note))]
      .filter((r): r is string => !!r),
  );
  const taggedTransferIds = new Set<string>();
  const taggedOrderIds = new Set<string>();
  for (const l of liveLoans) {
    if (l.source?.type === 'exchange') for (const id of l.source.transferIds) taggedTransferIds.add(id);
    if (l.source?.type === 'exchange_order') taggedOrderIds.add(l.source.orderId);
  }

  const entityLabel = (id: string): ReferenceStatus | null => {
    const batch = batches.find(b => b.id === id);
    if (batch) return { kind: 'registered', as: 'batch', label: batch.source || 'Stock batch' };
    const trade = liveTrades.find(tr => tr.id === id);
    if (trade) return { kind: 'registered', as: 'trade', label: trade.note?.slice(0, 60) || 'Order' };
    const loan = liveLoans.find(l => l.id === id);
    if (loan) return { kind: 'registered', as: 'loan', label: loan.counterpartyName };
    return null;
  };

  const exchange: ExchangeReferenceHit[] = [];

  for (const tr of input.transfers || []) {
    if (!(contains(tr.reference, q) || contains(tr.counterparty, q))) continue;
    let status: ReferenceStatus = { kind: 'pending' };
    if (taggedTransferIds.has(tr.id)) {
      status = { kind: 'registered', as: 'loan', label: 'Merchant loan' };
    } else if (tr.dismissed_at) {
      status = { kind: 'resolved', reason: tr.dismiss_reason ?? 'ignored', note: tr.dismiss_note ?? null };
    } else if (tr.linked_at && tr.linked_entity_id && liveIds.has(tr.linked_entity_id)) {
      status = entityLabel(tr.linked_entity_id) ?? status;
    } else if (importedRefs.has(tr.reference)) {
      status = { kind: 'registered', as: 'imported', label: 'Imported' };
    }
    exchange.push({
      key: `t:${tr.id}`, source: 'transfer', id: tr.id, exchange: tr.exchange, direction: tr.direction,
      usdt: Number(tr.amount), ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0, reference: tr.reference,
      counterparty: tr.counterparty, network: tr.network, exchangeStatus: tr.status,
      unregisteredUsdt: status.kind === 'pending' ? Number(tr.amount) : 0, status,
    });
  }

  for (const o of input.orders || []) {
    if (!contains(o.order_number, q)) continue;
    const links = (input.linksByOrder?.get(o.id) ?? []).filter(l => liveIds.has(l.entity_id));
    let linked = sumLinkedAmount(links);
    if (linked <= 0.01 && ((o.linked_at && o.linked_entity_id && liveIds.has(o.linked_entity_id)) || importedRefs.has(o.order_number))) {
      linked = Number(o.amount);
    }
    const unregistered = Math.max(0, Number(o.amount) - linked);
    let status: ReferenceStatus = { kind: 'pending' };
    if (o.dismissed_at) status = { kind: 'resolved', reason: o.dismiss_reason ?? 'ignored', note: o.dismiss_note ?? null };
    else if (taggedOrderIds.has(o.id)) status = { kind: 'registered', as: 'loan', label: 'Merchant loan' };
    else if (unregistered <= 0.01) {
      const firstLink = links[0]?.entity_id ?? o.linked_entity_id;
      status = (firstLink && entityLabel(firstLink)) || { kind: 'registered', as: 'imported', label: 'Imported' };
    }
    exchange.push({
      key: `o:${o.id}`, source: 'order', id: o.id, exchange: o.exchange, direction: o.side === 'sell' ? 'out' : 'in',
      usdt: Number(o.amount), ts: o.order_time ? new Date(o.order_time).getTime() : 0, reference: o.order_number,
      counterparty: o.counterparty, network: null, exchangeStatus: o.status, price: o.price, fiat: o.fiat,
      unregisteredUsdt: status.kind === 'pending' ? unregistered : 0, status,
    });
  }

  const tracker: TrackerReferenceHit[] = [];
  for (const b of batches) {
    if (contains(b.note, q) || contains(b.source, q)) {
      tracker.push({ key: `b:${b.id}`, kind: 'batch', id: b.id, ts: b.ts, amountUSDT: b.initialUSDT, label: b.source || 'Stock batch', note: b.note });
    }
  }
  for (const tr of trades) {
    if (contains(tr.note, q) || contains(tr.exchangeOrderNumber, q)) {
      tracker.push({ key: `tr:${tr.id}`, kind: 'trade', id: tr.id, ts: tr.ts, amountUSDT: tr.amountUSDT, label: tr.voided ? 'Voided order' : 'Order', note: tr.note });
    }
  }
  for (const l of loans) {
    const ref = l.source?.type === 'exchange' ? l.source.reference : l.source?.type === 'exchange_order' ? l.source.orderNumber : undefined;
    if (contains(ref, q) || contains(l.note, q)) {
      tracker.push({ key: `l:${l.id}`, kind: 'loan', id: l.id, ts: l.ts, amountUSDT: l.amountUSDT, label: l.counterpartyName, note: l.note ?? '' });
    }
  }

  exchange.sort((a, b) => b.ts - a.ts);
  tracker.sort((a, b) => b.ts - a.ts);
  return { exchange, tracker };
}
