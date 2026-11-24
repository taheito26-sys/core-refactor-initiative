// ─── Customer bank book ─────────────────────────────────────────────
//
// The buyer's own bank accounts (cash_accounts rows owned by the buyer) and
// every movement on them. Money comes in from the merchant's orders, which
// are deposited automatically into the buyer's primary account of the same
// currency, and goes out as transfers the buyer records to the people they
// pay (suppliers, clients). Everything here is pure so the tab only renders.

import type { PublicStatement } from '@/features/stock/components/PublicStatementReport';

export interface BankAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  status: string;
  created_at: number | string;
  /** Orders dated on or after this moment flow into the account; falls back to created_at. */
  last_reconciled?: number | null;
  bank_name?: string | null;
  /** Free text; the Banks tab keeps the saved beneficiaries here as JSON. */
  notes?: string | null;
}

export interface BankLedgerRow {
  id: string;
  account_id: string;
  contra_account_id: string | null;
  ts: number;
  type: string;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  note: string | null;
  linked_entity_id: string | null;
  linked_entity_type: string | null;
}

/** One order the merchant recorded for this buyer: the fiat the buyer received. */
export interface MerchantOrder {
  key: string;
  date: number;
  currency: string;
  amount: number;
  orderNumber?: string | null;
}

export type BankMoveKind =
  | 'order'
  | 'deposit'
  | 'opening'
  | 'payout'
  | 'withdrawal'
  | 'move_in'
  | 'move_out';

export interface BankMove {
  id: string;
  accountId: string;
  ts: number;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  kind: BankMoveKind;
  payee: string | null;
  note: string | null;
  /** The merchant order behind an order deposit. */
  orderKey?: string;
  orderNumber?: string | null;
  /** The stored ledger row; absent on an order deposit that is derived, not stored. */
  ledgerId?: string;
  /** The other account of a transfer between the buyer's own accounts. */
  contraAccountId?: string | null;
}

// ─── Storage encodings ─────────────────────────────────────────────

/*
 * cash_ledger.linked_entity_type only accepts batch, trade and customer_order,
 * so two things are encoded into existing columns instead of new ones:
 *
 * - An order the buyer moved to a non-primary account is an order_receipt
 *   row linked as customer_order with the id "merchant-order:<key>". It can
 *   never collide with a portal order, whose ids are UUIDs.
 * - The person paid is kept at the front of the note as "to:<payee>|<note>".
 */
export const ORDER_LINK_PREFIX = 'merchant-order:';
const PAYEE_PREFIX = 'to:';

export function orderLinkId(orderKey: string): string {
  return `${ORDER_LINK_PREFIX}${orderKey}`;
}

export function cleanPayeeName(name: string): string {
  return name.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
}

export function encodePayeeNote(payee: string | null, note: string | null): string | null {
  const p = payee ? cleanPayeeName(payee) : '';
  const n = (note ?? '').trim();
  if (!p) return n || null;
  return `${PAYEE_PREFIX}${p}|${n}`;
}

export function decodePayeeNote(raw: string | null): { payee: string | null; note: string | null } {
  if (!raw) return { payee: null, note: null };
  if (!raw.startsWith(PAYEE_PREFIX)) return { payee: null, note: raw };
  const body = raw.slice(PAYEE_PREFIX.length);
  const bar = body.indexOf('|');
  const payee = (bar < 0 ? body : body.slice(0, bar)).trim();
  const note = bar < 0 ? '' : body.slice(bar + 1).trim();
  return { payee: payee || null, note: note || null };
}

/** Same person whatever the spacing or letter case they were typed with. */
export function payeeKey(name: string): string {
  return cleanPayeeName(name).toLowerCase();
}

// ─── Time helpers (viewer's local timezone) ─────────────────────────

export function toMs(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${monthKeyOf(ts)}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Orders from the merchant's statements ─────────────────────────

type SalesStatement = PublicStatement & {
  saleOnly?: boolean;
  saleOrders?: Array<{ tradeId: string; orderNumber: string; date: string | number | null; fiat: string; fiatAmount: number }>;
};

function dateMs(v: string | number | null | undefined): number {
  return typeof v === 'string' ? new Date(v).getTime() : (v ?? 0);
}

/*
 * The same set of orders the buyer's Orders page lists from the statements:
 * every exchange trade linked to a loan, every loan without a trade, and every
 * plain sale once. A trade reached through several statement links is
 * counted once.
 */
export function merchantOrdersFromStatements(statements: SalesStatement[]): MerchantOrder[] {
  const out: MerchantOrder[] = [];
  const seen = new Set<string>();
  const loanTradeIds = new Set<string>();
  for (const s of statements) for (const o of s.orders ?? []) if (o.tradeId) loanTradeIds.add(o.tradeId);

  const push = (o: MerchantOrder) => {
    if (seen.has(o.key) || !(o.amount > 0)) return;
    seen.add(o.key);
    out.push(o);
  };

  for (const s of statements) {
    const loanTrade = new Set((s.orders ?? []).filter(o => o.tradeId).map(o => o.tradeId as string));
    const tradesSeen = new Set<string>();
    for (const b of s.binanceOrders ?? []) {
      if (!loanTrade.has(b.tradeId)) continue;
      tradesSeen.add(b.tradeId);
      push({ key: b.orderNumber || b.tradeId, orderNumber: b.orderNumber || null, date: dateMs(b.date), currency: b.fiat, amount: b.fiatAmount });
    }
    for (const o of s.orders ?? []) {
      if (o.tradeId && tradesSeen.has(o.tradeId)) continue;
      push({ key: o.ref, orderNumber: o.ref, date: o.date, currency: s.currency, amount: o.amount });
    }
  }
  for (const s of statements) {
    for (const sale of s.saleOrders ?? []) {
      if (loanTradeIds.has(sale.tradeId)) continue;
      push({ key: sale.orderNumber || sale.tradeId, orderNumber: sale.orderNumber || null, date: dateMs(sale.date), currency: sale.fiat, amount: sale.fiatAmount });
    }
  }
  return out;
}

// ─── Accounts ──────────────────────────────────────────────────────

export function activeAccounts(accounts: BankAccount[]): BankAccount[] {
  return accounts.filter(a => a.status === 'active');
}

/** Where a currency's orders land by default: the oldest bank account in it, else the oldest account. */
export function primaryAccountId(currency: string, accounts: BankAccount[]): string | null {
  const pool = activeAccounts(accounts)
    .filter(a => a.currency === currency)
    .sort((a, b) => (a.type === 'bank' ? 0 : 1) - (b.type === 'bank' ? 0 : 1) || toMs(a.created_at) - toMs(b.created_at));
  return pool[0]?.id ?? null;
}

export function ordersStartOf(account: BankAccount): number {
  return account.last_reconciled ?? toMs(account.created_at);
}

// ─── Moves ─────────────────────────────────────────────────────────

function kindOf(row: BankLedgerRow, payee: string | null): BankMoveKind {
  switch (row.type) {
    case 'order_receipt': return 'order';
    case 'opening': return 'opening';
    case 'transfer_in': return 'move_in';
    case 'transfer_out': return 'move_out';
    case 'withdrawal': return payee ? 'payout' : 'withdrawal';
    case 'deposit': return 'deposit';
    default: return row.direction === 'in' ? 'deposit' : (payee ? 'payout' : 'withdrawal');
  }
}

/** Every movement on the buyer's active accounts, newest first. */
export function buildBankMoves(accounts: BankAccount[], ledger: BankLedgerRow[], orders: MerchantOrder[]): BankMove[] {
  const active = activeAccounts(accounts);
  const activeIds = new Set(active.map(a => a.id));
  const moves: BankMove[] = [];
  const routed = new Set<string>();

  for (const row of ledger) {
    const linked = row.linked_entity_id ?? '';
    const orderKey = row.type === 'order_receipt' && linked.startsWith(ORDER_LINK_PREFIX) ? linked.slice(ORDER_LINK_PREFIX.length) : undefined;
    if (orderKey) routed.add(orderKey);
    if (!activeIds.has(row.account_id)) continue;
    const { payee, note } = decodePayeeNote(row.note);
    moves.push({
      id: row.id,
      ledgerId: row.id,
      accountId: row.account_id,
      ts: row.ts,
      direction: row.direction,
      amount: Number(row.amount) || 0,
      currency: row.currency,
      kind: kindOf(row, payee),
      payee,
      note,
      orderKey,
      orderNumber: orderKey ?? null,
      contraAccountId: row.contra_account_id,
    });
  }

  const byId = new Map(active.map(a => [a.id, a]));
  for (const o of orders) {
    if (routed.has(o.key)) continue;
    const accId = primaryAccountId(o.currency, accounts);
    const acc = accId ? byId.get(accId) : null;
    if (!acc || o.date < ordersStartOf(acc)) continue;
    moves.push({
      id: `order:${o.key}`,
      accountId: acc.id,
      ts: o.date,
      direction: 'in',
      amount: o.amount,
      currency: o.currency,
      kind: 'order',
      payee: null,
      note: null,
      orderKey: o.key,
      orderNumber: o.orderNumber ?? null,
    });
  }

  return moves.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

export function accountBalances(moves: BankMove[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of moves) m.set(mv.accountId, (m.get(mv.accountId) ?? 0) + (mv.direction === 'in' ? mv.amount : -mv.amount));
  return m;
}

/** The account balance right after each move, keyed by move id. */
export function runningBalances(moves: BankMove[]): Map<string, number> {
  const asc = [...moves].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const per = new Map<string, number>();
  const out = new Map<string, number>();
  for (const mv of asc) {
    const next = (per.get(mv.accountId) ?? 0) + (mv.direction === 'in' ? mv.amount : -mv.amount);
    per.set(mv.accountId, next);
    out.set(mv.id, next);
  }
  return out;
}

// ─── Analysis ──────────────────────────────────────────────────────

/** Money that arrived from outside: orders and deposits. Opening balances and own-account moves are not income. */
export function isIncome(mv: BankMove): boolean {
  return mv.kind === 'order' || mv.kind === 'deposit';
}

/** Money that left to someone else. A move between the buyer's own accounts is not spending. */
export function isSpending(mv: BankMove): boolean {
  return mv.kind === 'payout' || mv.kind === 'withdrawal';
}

export interface PayeeStat {
  key: string;
  name: string | null;
  total: number;
  count: number;
  share: number;
  average: number;
  lastTs: number;
}

export interface BankSummary {
  moneyIn: number;
  orderIn: number;
  orderCount: number;
  moneyOut: number;
  net: number;
  transferCount: number;
  payees: PayeeStat[];
  largest: BankMove | null;
  busiestDay: { day: string; total: number } | null;
  /** In and out per day (a month view) or per month (all time), oldest first. */
  series: Array<{ key: string; in: number; out: number }>;
  spentPct: number;
}

export const NO_PAYEE_KEY = '__none__';

export function summarizeMoves(moves: BankMove[], month: string | null): BankSummary {
  const scoped = month ? moves.filter(m => monthKeyOf(m.ts) === month) : moves;
  let moneyIn = 0, orderIn = 0, orderCount = 0, moneyOut = 0, transferCount = 0;
  let largest: BankMove | null = null;
  const payees = new Map<string, PayeeStat>();
  const days = new Map<string, number>();
  const series = new Map<string, { in: number; out: number }>();
  const bucket = (ts: number) => (month ? dayKeyOf(ts) : monthKeyOf(ts));

  for (const m of scoped) {
    if (isIncome(m)) {
      moneyIn += m.amount;
      if (m.kind === 'order') { orderIn += m.amount; orderCount += 1; }
      const s = series.get(bucket(m.ts)) ?? { in: 0, out: 0 };
      s.in += m.amount;
      series.set(bucket(m.ts), s);
    } else if (isSpending(m)) {
      moneyOut += m.amount;
      transferCount += 1;
      if (!largest || m.amount > largest.amount) largest = m;
      const key = m.payee ? payeeKey(m.payee) : NO_PAYEE_KEY;
      const p = payees.get(key) ?? { key, name: m.payee, total: 0, count: 0, share: 0, average: 0, lastTs: 0 };
      p.total += m.amount;
      p.count += 1;
      if (m.ts > p.lastTs) { p.lastTs = m.ts; if (m.payee) p.name = m.payee; }
      payees.set(key, p);
      const d = dayKeyOf(m.ts);
      days.set(d, (days.get(d) ?? 0) + m.amount);
      const s = series.get(bucket(m.ts)) ?? { in: 0, out: 0 };
      s.out += m.amount;
      series.set(bucket(m.ts), s);
    }
  }

  const payeeList = [...payees.values()]
    .map(p => ({ ...p, share: moneyOut > 0 ? p.total / moneyOut : 0, average: p.count ? p.total / p.count : 0 }))
    .sort((a, b) => b.total - a.total || b.count - a.count);

  let busiestDay: BankSummary['busiestDay'] = null;
  for (const [day, total] of days) if (!busiestDay || total > busiestDay.total) busiestDay = { day, total };

  return {
    moneyIn,
    orderIn,
    orderCount,
    moneyOut,
    net: moneyIn - moneyOut,
    transferCount,
    payees: payeeList,
    largest,
    busiestDay,
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v })),
    spentPct: moneyIn > 0 ? Math.round((moneyOut / moneyIn) * 100) : 0,
  };
}

/** Payees the buyer has used, most used first, for one-tap picking. */
export function knownPayees(moves: BankMove[]): string[] {
  const m = new Map<string, { name: string; n: number; last: number }>();
  for (const mv of moves) {
    if (!mv.payee) continue;
    const k = payeeKey(mv.payee);
    const e = m.get(k) ?? { name: mv.payee, n: 0, last: 0 };
    e.n += 1;
    if (mv.ts >= e.last) { e.last = mv.ts; e.name = mv.payee; }
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).map(e => e.name);
}
