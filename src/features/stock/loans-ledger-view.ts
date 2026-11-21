// ─── The Loans page as a ledger ───
//
// One list of every USDT movement with merchants, newest first, each with the direction it moved (OUT of
// my stock or IN to it), who it was with, whether the other merchant has confirmed it, and the running
// balance with that merchant afterwards. On top of it: what I am owed, what I owe, and what is waiting.
//
// Consignments are USDT I sent for a merchant to sell, not loans: they have their own workspace and cash
// accounting, and their sold part is no longer "owed back" as USDT. They are kept out of loan balances
// and summarised separately, so a loan balance never counts USDT that was sold.

import type { UsdtTransfer, UsdtTransferKind } from '@/lib/usdt-transfers';
import { buildMerchantStatements, type MerchantStatement } from './loan-ledger';
import { listConsignments } from './consignment';
import type { SharedLoanMove } from './loan-sync';

const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type LedgerStatus = 'confirmed' | 'pending' | 'not_shared';
export type LedgerLabel = 'lent' | 'returned' | 'borrowed' | 'repaid';

export interface LedgerRow {
  id: string;
  ts: number;
  merchantKey: string;
  merchant: string;
  kind: UsdtTransferKind;
  /** From my stock's side: out = USDT left me, in = USDT came to me. */
  direction: 'out' | 'in';
  label: LedgerLabel;
  amount: number;
  /** After this movement: > 0 I owe the merchant, < 0 the merchant owes me. */
  balanceAfter: number;
  /** confirmed = the connected merchant approved it; pending = waiting for them; not_shared = recorded on my side only. */
  status: LedgerStatus;
  source: 'manual' | 'exchange' | 'stock' | 'order';
  transfer: UsdtTransfer;
}

export interface LedgerMerchant {
  key: string;
  name: string;
  /** > 0 I owe them, < 0 they owe me. */
  net: number;
  /** What the merchant still owes me (USDT), or 0. */
  owesMe: number;
  /** What I still owe the merchant (USDT), or 0. */
  iOwe: number;
  /** Total that left my stock to them as loans / came to my stock from them. */
  lentTotal: number;
  returnedTotal: number;
  borrowedTotal: number;
  repaidTotal: number;
  /** 0–1: how much of the open direction has been settled — a bar the eye can read. */
  settledShare: number;
  movements: number;
  lastTs: number;
  pendingCount: number;
}

export interface LedgerTotals {
  owedToMe: number;
  iOwe: number;
  /** owedToMe − iOwe: positive means merchants owe me more than I owe them. */
  net: number;
  merchantsOwingMe: number;
  merchantsIOwe: number;
  pendingCount: number;
  pendingUSDT: number;
}

export interface ConsignmentSummaryRow {
  openCount: number;
  stillWithMerchants: number;
  merchants: string[];
}

export interface LoanLedger {
  rows: LedgerRow[];
  merchants: LedgerMerchant[];
  /** Requests from a connected merchant waiting for my answer: not booked on my side yet. */
  incoming: SharedLoanMove[];
  totals: LedgerTotals;
  consignments: ConsignmentSummaryRow;
}

const LABEL: Record<UsdtTransferKind, LedgerLabel> = {
  lend_out: 'lent', lend_return: 'returned', borrow_in: 'borrowed', borrow_repay: 'repaid',
};

function sourceOf(t: UsdtTransfer): LedgerRow['source'] {
  const s = t.source?.type;
  if (!s) return 'manual';
  if (s === 'exchange' || s === 'exchange_order') return 'exchange';
  if (s === 'batch') return 'stock';
  return 'order';
}

export function buildLoanLedger(
  transfers: UsdtTransfer[] | undefined,
  sharedMoves: SharedLoanMove[] = [],
  connectedNames: ReadonlySet<string> = new Set(),
): LoanLedger {
  const all = transfers || [];
  // Consignments (the send and any unsold return) are shown with their own workspace, not as loans.
  const loans = all.filter(t => !t.consignment && !t.consignmentId);
  const statements: MerchantStatement[] = buildMerchantStatements(loans);
  const moveById = new Map(sharedMoves.map(m => [m.id, m]));

  const rows: LedgerRow[] = [];
  const merchants: LedgerMerchant[] = [];
  for (const s of statements) {
    let lent = 0, returned = 0, borrowed = 0, repaid = 0, pending = 0;
    for (const l of s.lines) {
      const move = l.transfer.remoteLoanId ? moveById.get(l.transfer.remoteLoanId) : undefined;
      const status: LedgerStatus = !l.transfer.remoteLoanId ? 'not_shared' : move?.status === 'pending' ? 'pending' : 'confirmed';
      if (status === 'pending') pending += 1;
      if (l.kind === 'lend_out') lent += l.amount;
      else if (l.kind === 'lend_return') returned += l.amount;
      else if (l.kind === 'borrow_in') borrowed += l.amount;
      else repaid += l.amount;
      rows.push({
        id: l.id, ts: l.ts, merchantKey: s.key, merchant: s.name, kind: l.kind, direction: l.direction, label: LABEL[l.kind],
        amount: l.amount, balanceAfter: l.balanceAfter, status, source: sourceOf(l.transfer), transfer: l.transfer,
      });
    }
    const owesMe = s.net < -EPS ? round6(-s.net) : 0;
    const iOwe = s.net > EPS ? round6(s.net) : 0;
    // The bar shows the direction that is still open: what has come back of what I lent, or been repaid of what I borrowed.
    const base = owesMe > 0 ? lent : iOwe > 0 ? borrowed : lent + borrowed;
    const done = owesMe > 0 ? returned : iOwe > 0 ? repaid : returned + repaid;
    merchants.push({
      key: s.key, name: s.name, net: s.net, owesMe, iOwe,
      lentTotal: round6(lent), returnedTotal: round6(returned), borrowedTotal: round6(borrowed), repaidTotal: round6(repaid),
      settledShare: base > EPS ? Math.max(0, Math.min(1, done / base)) : 1,
      movements: s.lines.length, lastTs: s.lastTs, pendingCount: pending,
    });
  }
  rows.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
  void connectedNames;

  const incoming = sharedMoves.filter(m => !m.iAmProposer && m.status === 'pending');
  const waiting = sharedMoves.filter(m => m.iAmProposer && m.status === 'pending');
  const owedToMe = round6(merchants.reduce((s, m) => s + m.owesMe, 0));
  const iOwe = round6(merchants.reduce((s, m) => s + m.iOwe, 0));
  const open = listConsignments({ usdtTransfers: all }).filter(c => c.status === 'open');

  return {
    rows, merchants, incoming,
    totals: {
      owedToMe, iOwe, net: round6(owedToMe - iOwe),
      merchantsOwingMe: merchants.filter(m => m.owesMe > 0).length,
      merchantsIOwe: merchants.filter(m => m.iOwe > 0).length,
      pendingCount: incoming.length + waiting.length,
      pendingUSDT: round6([...incoming, ...waiting].reduce((s, m) => s + m.amountUSDT, 0)),
    },
    consignments: {
      openCount: open.length,
      stillWithMerchants: round6(open.reduce((s, c) => s + c.open, 0)),
      merchants: Array.from(new Set(open.map(c => c.counterpartyName))),
    },
  };
}

export type LedgerFilter = 'all' | 'out' | 'in' | 'pending';

/** Rows for the chosen filter, optionally limited to one merchant. */
export function filterLedger(rows: LedgerRow[], filter: LedgerFilter, merchantKey?: string): LedgerRow[] {
  return rows.filter(r => {
    if (merchantKey && r.merchantKey !== merchantKey) return false;
    if (filter === 'out') return r.direction === 'out';
    if (filter === 'in') return r.direction === 'in';
    if (filter === 'pending') return r.status === 'pending';
    return true;
  });
}
