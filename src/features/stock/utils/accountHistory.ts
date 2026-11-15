// Relative imports only, so this file can be reused from an edge function if the statement is ever built server-side.
import type { StatementEntry } from './loanStatement.ts';

/**
 * A bank-statement view of what a buyer owes.
 *
 * Every row is either a charge (a new order on credit) or a payment, and every
 * row carries the unpaid balance before it and after it. The balance is always
 * recomputed here from the raw amounts, never copied from the statement entries:
 * a buyer who exists as several customer records has entries merged from all of
 * them, and the per-record balances those entries carry no longer mean anything.
 */

export interface HistoryEvent {
  id: string;
  ts: number;
  kind: 'charge' | 'payment';
  /** Always positive. */
  amount: number;
  ref: string;
  description: string;
  /** Payments sharing a group id are one physical payment split across several orders. */
  groupId?: string;
  method?: 'cash' | 'bank' | null;
  accountName?: string;
}

export interface HistoryLine {
  id: string;
  ts: number;
  kind: 'charge' | 'payment';
  amount: number;
  refs: string[];
  description: string;
  method?: 'cash' | 'bank' | null;
  accountName?: string;
  /** Unpaid balance before this row. */
  before: number;
  /** Unpaid balance after this row. A negative balance means the buyer is in credit. */
  after: number;
  /** How many orders a grouped payment was spread across. */
  parts: number;
}

export interface HistoryView {
  opening: number;
  closing: number;
  lines: HistoryLine[];
  charges: number;
  payments: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Charges and grouped payments on one timeline with the balance before and after each. */
export function buildHistoryLines(events: HistoryEvent[]): HistoryLine[] {
  const grouped = new Map<string, HistoryLine>();
  const rows: HistoryLine[] = [];
  for (const e of events) {
    const amount = Number(e.amount) || 0;
    if (!(amount > 0)) continue;
    const key = e.kind === 'payment' && e.groupId ? `p:${e.groupId}` : null;
    const existing = key ? grouped.get(key) : undefined;
    if (existing) {
      existing.amount = round2(existing.amount + amount);
      existing.ts = Math.min(existing.ts, e.ts);
      existing.parts += 1;
      if (e.ref && !existing.refs.includes(e.ref)) existing.refs.push(e.ref);
      if (!existing.description && e.description) existing.description = e.description;
      if (!existing.method && e.method) existing.method = e.method;
      continue;
    }
    const row: HistoryLine = {
      id: e.id, ts: e.ts, kind: e.kind, amount: round2(amount), refs: e.ref ? [e.ref] : [],
      description: e.description || '', method: e.method ?? undefined, accountName: e.accountName,
      before: 0, after: 0, parts: 1,
    };
    rows.push(row);
    if (key) grouped.set(key, row);
  }
  // A charge and a payment in the same instant read charge first, so a same-day order never shows a credit.
  rows.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === 'charge' ? -1 : 1));
  let running = 0;
  for (const row of rows) {
    row.before = running;
    running = round2(running + (row.kind === 'charge' ? row.amount : -row.amount));
    row.after = running;
  }
  return rows;
}

/** The statement for one period: the balance it opened with, its rows, and the balance it closed with. */
export function historyView(lines: HistoryLine[], from?: number | null, to?: number | null): HistoryView {
  const start = from ?? -Infinity;
  const end = to ?? Infinity;
  const before = lines.filter(l => l.ts < start);
  const inside = lines.filter(l => l.ts >= start && l.ts <= end);
  const opening = before.length ? before[before.length - 1].after : 0;
  const closing = inside.length ? inside[inside.length - 1].after : opening;
  return {
    opening, closing, lines: inside,
    charges: round2(inside.filter(l => l.kind === 'charge').reduce((s, l) => s + l.amount, 0)),
    payments: round2(inside.filter(l => l.kind === 'payment').reduce((s, l) => s + l.amount, 0)),
  };
}

/** What was unpaid at a moment in the past. */
export function balanceAsOf(lines: HistoryLine[], ts: number): number {
  let balance = 0;
  for (const l of lines) { if (l.ts <= ts) balance = l.after; else break; }
  return balance;
}

/** The statement entries of the merchant side, as events. */
export function eventsFromEntries(entries: Array<Pick<StatementEntry, 'id' | 'ts' | 'kind' | 'debit' | 'credit' | 'ref' | 'description' | 'batchId' | 'method' | 'accountName'>>): HistoryEvent[] {
  return entries.map(e => ({
    id: e.id, ts: e.ts, kind: e.kind, amount: e.kind === 'charge' ? e.debit : e.credit,
    ref: e.ref, description: e.description, groupId: e.batchId, method: e.method ?? null, accountName: e.accountName,
  }));
}

/** The buyer-facing statement shape, as events. Its figures are rounded, so a final row absorbs any rounding gap to `outstanding`. */
export function eventsFromPublicStatement(data: {
  outstanding: number;
  orders: Array<{ ref: string; date: number; amount: number; note: string | null }>;
  payments: Array<{ date: number; amount: number; note: string | null; ref: string | null; method?: 'cash' | 'bank' | null }>;
}, roundingLabel = 'Rounding'): HistoryEvent[] {
  const events: HistoryEvent[] = [
    ...data.orders.map((o, i): HistoryEvent => ({ id: `o${i}`, ts: Number(o.date), kind: 'charge', amount: o.amount, ref: o.ref, description: o.note || '' })),
    ...data.payments.map((p, i): HistoryEvent => ({ id: `p${i}`, ts: Number(p.date), kind: 'payment', amount: p.amount, ref: p.ref || '', description: p.note || '', method: p.method ?? null })),
  ].filter(e => Number.isFinite(e.ts));
  const lines = buildHistoryLines(events);
  const gap = round2((lines.length ? lines[lines.length - 1].after : 0) - data.outstanding);
  if (gap !== 0 && Math.abs(gap) < 50) {
    const last = lines.length ? lines[lines.length - 1].ts : Date.now();
    events.push({ id: 'rounding', ts: last + 1, kind: gap > 0 ? 'payment' : 'charge', amount: Math.abs(gap), ref: '', description: roundingLabel });
  }
  return events;
}

export interface HistoryClaim {
  id: string;
  customerId: string;
  currency: string;
  amount: number;
  status: string;
  source: string;
  appliedBatchId: string | null;
  note: string | null;
  paidAt: string;
}

/**
 * Payments the merchant accepted that left no repayment behind: the claim says accepted and names the batch it
 * was applied under, but no payment in the account carries that batch. The buyer sees the payment as accepted
 * while the unpaid balance never went down.
 */
export function findUnappliedClaims(claims: HistoryClaim[], entries: Array<Pick<StatementEntry, 'kind' | 'batchId'>>, customerIds: Set<string>, currency: string): HistoryClaim[] {
  const applied = new Set(entries.filter(e => e.kind === 'payment' && e.batchId).map(e => e.batchId));
  return claims.filter(c => c.status === 'accepted' && c.source === 'customer_claim' && c.currency === currency
    && customerIds.has(c.customerId) && !!c.appliedBatchId && !applied.has(c.appliedBatchId));
}
