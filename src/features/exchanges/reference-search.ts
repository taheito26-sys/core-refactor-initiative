import { fmtDate, type TrackerState } from '@/lib/tracker-helpers';
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
  | { kind: 'registered'; as: 'batch' | 'trade' | 'loan' | 'imported'; label: string; entityId?: string };

/** One labelled line of detail on a record. */
export interface DetailRow {
  label: string;
  value: string;
}

/**
 * Which page is searching. Stock shows what came in (received USDT, stock
 * batches), Orders shows what went out (sent USDT, sales), and the Loans tab
 * shows everything, since a loan can be either way.
 */
export type ReferenceScope = 'stock' | 'orders' | 'all';

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
  /** Everything the exchange reported for this record, one row per field. */
  details: DetailRow[];
  /** The tracker batch / order / loan it became, in full, when registered. */
  linked?: TrackerReferenceHit;
}

export interface TrackerReferenceHit {
  key: string;
  kind: 'batch' | 'trade' | 'loan';
  id: string;
  ts: number;
  amountUSDT: number;
  label: string;
  note: string;
  details: DetailRow[];
}

export interface ReferenceSearchResult {
  exchange: ExchangeReferenceHit[];
  tracker: TrackerReferenceHit[];
  /** Matches left out because they belong to the other page's scope (received vs sent). */
  hiddenByScope: number;
}

const EMPTY: ReferenceSearchResult = { exchange: [], tracker: [], hiddenByScope: 0 };

const num = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e8) / 1e8) : '');

/**
 * Every top-level field of the exchange's own record, so nothing it returned
 * is hidden. Timestamps in milliseconds are shown as dates; nested values as JSON.
 */
export function describeRaw(raw: Record<string, unknown> | null | undefined): DetailRow[] {
  if (!raw || typeof raw !== 'object') return [];
  const rows: DetailRow[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue;
    let text: string;
    if (typeof value === 'object') text = JSON.stringify(value);
    else if (/time|ts$/i.test(key) && /^\d{12,13}$/.test(String(value))) text = new Date(Number(value)).toLocaleString();
    else text = String(value);
    rows.push({ label: key, value: text });
  }
  return rows;
}

const contains = (haystack: string | null | undefined, needle: string) =>
  !!haystack && String(haystack).toLowerCase().includes(needle);

export function searchReferences(input: {
  query: string;
  orders: ExchangeP2POrder[] | undefined;
  transfers: ExchangeTransfer[] | undefined;
  linksByOrder?: Map<string, ExchangeOrderLink[]>;
  state: Pick<TrackerState, 'batches' | 'trades' | 'usdtTransfers'> & Partial<Pick<TrackerState, 'customers'>>;
  scope?: ReferenceScope;
}): ReferenceSearchResult {
  const q = normalizeReferenceQuery(input.query);
  if (q.length < MIN_REFERENCE_QUERY) return EMPTY;
  const scope = input.scope ?? 'all';

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

  const customerName = (id: string) => (input.state.customers || []).find(c => c.id === id)?.name || '';
  const trackerHitFor = (kind: 'batch' | 'trade' | 'loan', id: string): TrackerReferenceHit | undefined => {
    if (kind === 'batch') {
      const b = batches.find(x => x.id === id);
      if (!b) return undefined;
      return {
        key: `b:${b.id}`, kind, id: b.id, ts: b.ts, amountUSDT: b.initialUSDT, label: b.source || 'Stock batch', note: b.note,
        details: [
          { label: 'Date', value: fmtDate(b.ts) }, { label: 'Supplier', value: b.source || '' },
          { label: 'USDT', value: num(b.initialUSDT) }, { label: 'Cost (QAR/USDT)', value: num(b.buyPriceQAR) },
          { label: 'Note', value: b.note || '' },
        ].filter(r => r.value),
      };
    }
    if (kind === 'trade') {
      const tr = trades.find(x => x.id === id);
      if (!tr) return undefined;
      return {
        key: `tr:${tr.id}`, kind, id: tr.id, ts: tr.ts, amountUSDT: tr.amountUSDT,
        label: (customerName(tr.customerId) || 'Order') + (tr.voided ? ' (voided)' : ''), note: tr.note,
        details: [
          { label: 'Date', value: fmtDate(tr.ts) }, { label: 'Buyer', value: customerName(tr.customerId) },
          { label: 'USDT', value: num(tr.amountUSDT) }, { label: 'Sell price (QAR/USDT)', value: num(tr.sellPriceQAR) },
          { label: 'Fee (QAR)', value: tr.feeQAR ? num(tr.feeQAR) : '' }, { label: 'Note', value: tr.note || '' },
        ].filter(r => r.value),
      };
    }
    const l = loans.find(x => x.id === id);
    if (!l) return undefined;
    return {
      key: `l:${l.id}`, kind, id: l.id, ts: l.ts, amountUSDT: l.amountUSDT, label: l.counterpartyName, note: l.note ?? '',
      details: [
        { label: 'Date', value: fmtDate(l.ts) }, { label: 'Merchant', value: l.counterpartyName }, { label: 'Type', value: l.kind },
        { label: 'USDT', value: num(l.amountUSDT) }, { label: 'Note', value: l.note || '' },
      ].filter(r => r.value),
    };
  };

  const entityStatus = (id: string): { status: ReferenceStatus; linked?: TrackerReferenceHit } | null => {
    for (const kind of ['batch', 'trade', 'loan'] as const) {
      const hit = trackerHitFor(kind, id);
      if (hit) return { status: { kind: 'registered', as: kind, label: hit.label, entityId: id }, linked: hit };
    }
    return null;
  };

  const exchange: ExchangeReferenceHit[] = [];

  for (const tr of input.transfers || []) {
    if (!(contains(tr.reference, q) || contains(tr.counterparty, q))) continue;
    let status: ReferenceStatus = { kind: 'pending' };
    let linked: TrackerReferenceHit | undefined;
    if (taggedTransferIds.has(tr.id)) {
      const loan = liveLoans.find(l => l.source?.type === 'exchange' && l.source.transferIds.includes(tr.id));
      const hit = loan ? trackerHitFor('loan', loan.id) : undefined;
      status = { kind: 'registered', as: 'loan', label: hit?.label || 'Merchant loan', entityId: loan?.id };
      linked = hit;
    } else if (tr.dismissed_at) {
      status = { kind: 'resolved', reason: tr.dismiss_reason ?? 'ignored', note: tr.dismiss_note ?? null };
    } else if (tr.linked_at && tr.linked_entity_id && liveIds.has(tr.linked_entity_id)) {
      const e = entityStatus(tr.linked_entity_id);
      if (e) { status = e.status; linked = e.linked; }
    } else if (importedRefs.has(tr.reference)) {
      status = { kind: 'registered', as: 'imported', label: 'Imported' };
    }
    exchange.push({
      key: `t:${tr.id}`, source: 'transfer', id: tr.id, exchange: tr.exchange, direction: tr.direction,
      usdt: Number(tr.amount), ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0, reference: tr.reference,
      counterparty: tr.counterparty, network: tr.network, exchangeStatus: tr.status,
      unregisteredUsdt: status.kind === 'pending' ? Number(tr.amount) : 0, status,
      details: describeRaw(tr.raw), linked,
    });
  }

  for (const o of input.orders || []) {
    if (!contains(o.order_number, q)) continue;
    const links = (input.linksByOrder?.get(o.id) ?? []).filter(l => liveIds.has(l.entity_id));
    let registeredUsdt = sumLinkedAmount(links);
    if (registeredUsdt <= 0.01 && ((o.linked_at && o.linked_entity_id && liveIds.has(o.linked_entity_id)) || importedRefs.has(o.order_number))) {
      registeredUsdt = Number(o.amount);
    }
    const unregistered = Math.max(0, Number(o.amount) - registeredUsdt);
    let status: ReferenceStatus = { kind: 'pending' };
    let linked: TrackerReferenceHit | undefined;
    if (o.dismissed_at) status = { kind: 'resolved', reason: o.dismiss_reason ?? 'ignored', note: o.dismiss_note ?? null };
    else if (taggedOrderIds.has(o.id)) {
      const loan = liveLoans.find(l => l.source?.type === 'exchange_order' && l.source.orderId === o.id);
      const hit = loan ? trackerHitFor('loan', loan.id) : undefined;
      status = { kind: 'registered', as: 'loan', label: hit?.label || 'Merchant loan', entityId: loan?.id };
      linked = hit;
    } else if (unregistered <= 0.01) {
      const firstLink = links[0]?.entity_id ?? o.linked_entity_id;
      const e = firstLink ? entityStatus(firstLink) : null;
      if (e) { status = e.status; linked = e.linked; } else status = { kind: 'registered', as: 'imported', label: 'Imported' };
    }
    const allocationRows: DetailRow[] = links.map(l => ({
      label: 'Registered as',
      value: `${num(l.allocated_amount)} USDT${l.customer_label ? ` · ${l.customer_label}` : ''}`,
    }));
    exchange.push({
      key: `o:${o.id}`, source: 'order', id: o.id, exchange: o.exchange, direction: o.side === 'sell' ? 'out' : 'in',
      usdt: Number(o.amount), ts: o.order_time ? new Date(o.order_time).getTime() : 0, reference: o.order_number,
      counterparty: o.counterparty, network: null, exchangeStatus: o.status, price: o.price, fiat: o.fiat,
      unregisteredUsdt: status.kind === 'pending' ? unregistered : 0, status,
      details: [
        { label: 'Fiat total', value: `${num(Number(o.total))} ${o.fiat}` },
        { label: 'Price', value: `${num(Number(o.price))} ${o.fiat}/USDT` },
        ...allocationRows,
        ...describeRaw(o.raw),
      ],
      linked,
    });
  }

  const tracker: TrackerReferenceHit[] = [];
  const shownEntityIds = new Set(exchange.map(h => h.linked?.id).filter(Boolean));
  for (const b of batches) {
    if (contains(b.note, q) || contains(b.source, q)) {
      const hit = trackerHitFor('batch', b.id);
      if (hit) tracker.push(hit);
    }
  }
  for (const tr of trades) {
    if (contains(tr.note, q) || contains(tr.exchangeOrderNumber, q)) {
      const hit = trackerHitFor('trade', tr.id);
      if (hit) tracker.push(hit);
    }
  }
  for (const l of loans) {
    const ref = l.source?.type === 'exchange' ? l.source.reference : l.source?.type === 'exchange_order' ? l.source.orderNumber : undefined;
    if (contains(ref, q) || contains(l.note, q)) {
      const hit = trackerHitFor('loan', l.id);
      if (hit) tracker.push(hit);
    }
  }

  // Received (in) belongs with stock, sent (out) with orders; loans fit either.
  const inScope = (direction: 'in' | 'out') => scope === 'all' || (scope === 'stock' ? direction === 'in' : direction === 'out');
  const trackerInScope = (kind: TrackerReferenceHit['kind']) =>
    scope === 'all' || (scope === 'stock' ? kind === 'batch' : kind === 'trade');
  const scopedExchange = exchange.filter(h => inScope(h.direction));
  const scopedTracker = tracker.filter(h => trackerInScope(h.kind) && !shownEntityIds.has(h.id));
  const hiddenByScope = exchange.length - scopedExchange.length + tracker.filter(h => !trackerInScope(h.kind)).length;

  scopedExchange.sort((a, b) => b.ts - a.ts);
  scopedTracker.sort((a, b) => b.ts - a.ts);
  return { exchange: scopedExchange, tracker: scopedTracker, hiddenByScope };
}
