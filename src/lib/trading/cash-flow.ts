import type { CashAccount, CashCurrency, CashLedgerEntry } from '../tracker-helpers';

// ─── Cash flow: what actually came in and went out ───

export type FlowKind = 'in' | 'out' | 'transfer' | 'adjustment';

export interface FlowRow {
  entry: CashLedgerEntry;
  kind: FlowKind;
  /** Signed: money in is positive, money out is negative. */
  signed: number;
}

export interface FlowTotals {
  currency: CashCurrency;
  inAmount: number;
  outAmount: number;
  net: number;
}

export interface FlowDay {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  rows: FlowRow[];
  totals: FlowTotals[];
}

export type FlowPeriod = 'today' | '7d' | 'month' | 'all';
export type FlowDirection = 'all' | 'in' | 'out';

export interface FlowFilter {
  from?: number;
  to?: number;
  accountId?: string;
  direction?: FlowDirection;
  /** Own-account transfers and balance corrections are not income or spending; they are hidden unless asked for. */
  includeInternal?: boolean;
  query?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Moves between the merchant's own accounts and corrections are not money entering or leaving the business. */
export function flowKindOf(e: Pick<CashLedgerEntry, 'type' | 'direction'>): FlowKind {
  if (e.type === 'transfer_in' || e.type === 'transfer_out') return 'transfer';
  if (e.type === 'opening' || e.type === 'reconcile' || e.type === 'stock_edit_adjust') return 'adjustment';
  return e.direction === 'in' ? 'in' : 'out';
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The start of the period (local time), or undefined for all time. */
export function periodStart(period: FlowPeriod, now: number): number | undefined {
  const d = new Date(now);
  if (period === 'today') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === '7d') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return undefined;
}

export function totalsOf(rows: FlowRow[]): FlowTotals[] {
  const by = new Map<CashCurrency, FlowTotals>();
  for (const r of rows) {
    if (r.kind !== 'in' && r.kind !== 'out') continue;
    const t = by.get(r.entry.currency) ?? { currency: r.entry.currency, inAmount: 0, outAmount: 0, net: 0 };
    if (r.kind === 'in') t.inAmount += r.entry.amount; else t.outAmount += r.entry.amount;
    by.set(r.entry.currency, t);
  }
  return [...by.values()]
    .map(t => ({ ...t, inAmount: round2(t.inAmount), outAmount: round2(t.outAmount), net: round2(t.inAmount - t.outAmount) }))
    .sort((a, b) => (a.currency === 'QAR' ? -1 : b.currency === 'QAR' ? 1 : a.currency.localeCompare(b.currency)));
}

/** Filtered ledger rows, newest first. */
export function flowRows(ledger: CashLedgerEntry[], accounts: CashAccount[], filter: FlowFilter = {}): FlowRow[] {
  const names = new Map(accounts.map(a => [a.id, a.name.toLowerCase()]));
  const q = (filter.query || '').trim().toLowerCase();
  const rows: FlowRow[] = [];
  for (const entry of ledger) {
    if (filter.from != null && entry.ts < filter.from) continue;
    if (filter.to != null && entry.ts > filter.to) continue;
    if (filter.accountId && entry.accountId !== filter.accountId) continue;
    const kind = flowKindOf(entry);
    if ((kind === 'transfer' || kind === 'adjustment') && !filter.includeInternal) continue;
    if (filter.direction === 'in' && entry.direction !== 'in') continue;
    if (filter.direction === 'out' && entry.direction !== 'out') continue;
    if (q) {
      const hay = `${entry.note || ''} ${entry.type} ${names.get(entry.accountId) || ''} ${entry.amount}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ entry, kind, signed: entry.direction === 'in' ? entry.amount : -entry.amount });
  }
  return rows.sort((a, b) => b.entry.ts - a.entry.ts);
}

export function groupByDay(rows: FlowRow[]): FlowDay[] {
  const days = new Map<string, FlowRow[]>();
  for (const r of rows) {
    const k = dayKey(r.entry.ts);
    (days.get(k) ?? days.set(k, []).get(k)!).push(r);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, rows: list, totals: totalsOf(list) }));
}

/** CSV of the rows, for a spreadsheet. */
export function flowToCsv(rows: FlowRow[], accounts: CashAccount[], typeLabel: (type: string) => string): string {
  const names = new Map(accounts.map(a => [a.id, a.name]));
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Date', 'Time', 'Account', 'Type', 'Direction', 'Amount', 'Currency', 'Note'].map(esc).join(',')];
  for (const { entry, signed } of rows) {
    const d = new Date(entry.ts);
    lines.push([
      dayKey(entry.ts), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      names.get(entry.accountId) || entry.accountId, typeLabel(entry.type), entry.direction === 'in' ? 'In' : 'Out',
      signed, entry.currency, entry.note || '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
