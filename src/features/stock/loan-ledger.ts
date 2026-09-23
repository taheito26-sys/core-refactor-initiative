// ─── Merchant USDT loans: one question, one ledger ───

/*
 * The merchant only ever says WHICH merchant a USDT move was with. Whether
 * it is a borrow, a repayment, a loan out or a loan coming back follows
 * from its direction and the running balance with that merchant:
 *
 * | USDT      | balance with the merchant  | becomes      |
 * |-----------|----------------------------|--------------|
 * | received  | they owe me                | lend_return  |
 * | received  | zero, or I owe them        | borrow_in    |
 * | sent      | I owe them                 | borrow_repay |
 * | sent      | zero, or they owe me       | lend_out     |
 *
 * A move that crosses zero is split (owing 5k and sending 8k = 5k repayment
 * + 3k lent); the parts share a groupId so they show and undo together.
 * Every part is recorded through the tagging transforms in usdt-tagging.ts,
 * so FIFO, P&L and exchange-inbox bookkeeping are exactly as before.
 */

import type { TrackerState } from '@/lib/tracker-helpers';
import {
  getUsdtTransferBalances,
  isTransferActive,
  isTransferIn,
  transferCounterpartyKey,
  type UsdtTransfer,
  type UsdtTransferKind,
} from '@/lib/usdt-transfers';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import {
  tagBatch,
  tagExchangeOrder,
  tagExchangeTransfer,
  tagTrade,
  untagTransfer,
  TagError,
  type TagResult,
} from './usdt-tagging';

const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A record the merchant says was a loan move with another merchant. */
export type LoanSource =
  | { type: 'batch'; batchId: string; available: number; ts: number }
  | { type: 'trade'; tradeId: string; available: number; ts: number }
  | { type: 'exchange_transfer'; transfer: ExchangeTransfer }
  | { type: 'exchange_order'; order: ExchangeP2POrder; available: number }
  | { type: 'manual'; direction: 'in' | 'out'; ts: number };

/** A record from the "Needs a decision" list as a LoanSource, or null when it can't be one. */
export function pendingItemToLoanSource(item: PendingExchangeItem): LoanSource | null {
  if (item.order) return { type: 'exchange_order', order: item.order, available: item.pendingUSDT };
  if (item.transfer) return { type: 'exchange_transfer', transfer: item.transfer };
  return null;
}

export function loanSourceDirection(src: LoanSource): 'in' | 'out' {
  switch (src.type) {
    case 'batch': return 'in';
    case 'trade': return 'out';
    case 'exchange_transfer': return src.transfer.direction;
    case 'exchange_order': return src.order.side === 'buy' ? 'in' : 'out';
    case 'manual': return src.direction;
  }
}

/** The whole amount the source can contribute (manual entries have none of their own). */
export function loanSourceAmount(src: LoanSource): number {
  switch (src.type) {
    case 'batch':
    case 'trade':
    case 'exchange_order':
      return src.available;
    case 'exchange_transfer': return Number(src.transfer.amount);
    case 'manual': return 0;
  }
}

/** A transfer is one movement on the exchange, so only the whole of it can be a loan move. */
export function loanSourceCanSplit(src: LoanSource): boolean {
  return src.type !== 'exchange_transfer' && src.type !== 'manual';
}

export function loanSourceTs(src: LoanSource): number {
  switch (src.type) {
    case 'batch':
    case 'trade':
    case 'manual':
      return src.ts;
    case 'exchange_transfer': return src.transfer.transfer_time ? new Date(src.transfer.transfer_time).getTime() : 0;
    case 'exchange_order': return src.order.order_time ? new Date(src.order.order_time).getTime() : 0;
  }
}

/** Net USDT position with one merchant: > 0 I owe them, < 0 they owe me. */
export function merchantNet(transfers: UsdtTransfer[] | undefined, name: string): number {
  const key = transferCounterpartyKey({ counterpartyName: name });
  const row = getUsdtTransferBalances(transfers).find(b => b.key === key);
  return row ? round6(row.owedToThem - row.owedToMe) : 0;
}

export interface LoanPlanPart {
  kind: UsdtTransferKind;
  amount: number;
}

/** What a move of `amount` in `direction` means given the current net position. */
export function planLoanMove(net: number, direction: 'in' | 'out', amount: number): { parts: LoanPlanPart[]; after: number } {
  const parts: LoanPlanPart[] = [];
  const qty = round6(amount);
  if (direction === 'in') {
    const back = net < 0 ? Math.min(qty, -net) : 0;
    if (back > EPS) parts.push({ kind: 'lend_return', amount: round6(back) });
    if (qty - back > EPS) parts.push({ kind: 'borrow_in', amount: round6(qty - back) });
    return { parts, after: round6(net + qty) };
  }
  const repay = net > 0 ? Math.min(qty, net) : 0;
  if (repay > EPS) parts.push({ kind: 'borrow_repay', amount: round6(repay) });
  if (qty - repay > EPS) parts.push({ kind: 'lend_out', amount: round6(qty - repay) });
  return { parts, after: round6(net - qty) };
}

/**
 * Use the spelling already on record for a merchant typed with different
 * case / spacing, so "abu tamim" never starts a second ledger next to
 * "Abu Tamim".
 */
export function canonicalMerchantName(name: string, known: string[]): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  const hit = known.find(k => k.trim().replace(/\s+/g, ' ').toLowerCase() === clean.toLowerCase());
  return hit ?? clean;
}

export interface LoanMoveResult extends TagResult {
  parts: LoanPlanPart[];
  netBefore: number;
  netAfter: number;
}

/**
 * Record `amount` of `src` as a loan move with `name`, split by the current
 * balance. `newId` supplies fresh ids (one per part, plus a group id).
 */
export function applyLoanMove(
  state: TrackerState,
  src: LoanSource,
  name: string,
  amount: number,
  newId: () => string,
  now = Date.now(),
): LoanMoveResult {
  const counterparty = name.trim();
  if (!counterparty) throw new TagError('not_found');
  const direction = loanSourceDirection(src);
  const full = loanSourceAmount(src);
  const qty = round6(amount);
  if (!(qty > 0)) throw new TagError('bad_amount');
  if (src.type !== 'manual' && qty > full + EPS) throw new TagError('bad_amount');
  if (src.type === 'exchange_transfer' && qty < full - EPS) throw new TagError('bad_amount');

  const netBefore = merchantNet(state.usdtTransfers, counterparty);
  const plan = planLoanMove(netBefore, direction, qty);
  const groupId = plan.parts.length > 1 ? newId() : undefined;

  let acc: TagResult = { state };
  const dismiss = new Set<string>();
  const orderLinks: NonNullable<TagResult['orderLinks']> = [];
  let orderAvailable = src.type === 'exchange_order' ? src.available : 0;

  for (const part of plan.parts) {
    const id = newId();
    let r: TagResult;
    switch (src.type) {
      case 'batch':
        r = tagBatch(acc.state, src.batchId, part.kind as 'borrow_in' | 'lend_return', counterparty, id, part.amount, now);
        break;
      case 'trade':
        r = tagTrade(acc.state, src.tradeId, part.kind as 'borrow_repay' | 'lend_out', counterparty, id, part.amount, now);
        break;
      case 'exchange_order':
        r = tagExchangeOrder(acc.state, src.order, part.kind, counterparty, id, orderAvailable, part.amount, now);
        orderAvailable = round6(orderAvailable - part.amount);
        break;
      case 'exchange_transfer':
        r = tagExchangeTransfer(acc.state, src.transfer, part.kind, counterparty, id, now, part.amount);
        break;
      case 'manual': {
        const row: UsdtTransfer = {
          id, ts: src.ts, kind: part.kind, amountUSDT: part.amount, counterpartyName: counterparty, createdAt: now, updatedAt: now,
        };
        r = { state: { ...acc.state, usdtTransfers: [...(acc.state.usdtTransfers || []), row] } };
        break;
      }
    }
    if (groupId) {
      r = { ...r, state: { ...r.state, usdtTransfers: (r.state.usdtTransfers || []).map(x => (x.id === id ? { ...x, groupId } : x)) } };
    }
    for (const d of r.dismiss || []) dismiss.add(d);
    orderLinks.push(...(r.orderLinks || []));
    acc = r;
  }

  return {
    state: acc.state,
    dismiss: Array.from(dismiss),
    orderLinks,
    parts: plan.parts,
    netBefore,
    netAfter: plan.after,
  };
}

/** Undo a loan move — every part of its group, newest first — restoring what each replaced. */
export function undoLoanMove(state: TrackerState, transferId: string, now = Date.now()): TagResult {
  const list = state.usdtTransfers || [];
  const row = list.find(x => x.id === transferId);
  if (!row) throw new TagError('not_found');
  const ids = row.groupId
    ? list.filter(x => x.groupId === row.groupId && !x.voided).map(x => x.id).reverse()
    : [row.id];
  let acc: TagResult = { state };
  const undismiss = new Set<string>();
  const removeOrderLinks: NonNullable<TagResult['removeOrderLinks']> = [];
  for (const id of ids) {
    const r = untagTransfer(acc.state, id, now);
    for (const u of r.undismiss || []) undismiss.add(u);
    removeOrderLinks.push(...(r.removeOrderLinks || []));
    acc = r;
  }
  return { state: acc.state, undismiss: Array.from(undismiss), removeOrderLinks };
}

export interface StatementLine {
  id: string;
  groupId?: string;
  ts: number;
  kind: UsdtTransferKind;
  direction: 'in' | 'out';
  amount: number;
  /** Net position after this line: > 0 I owe them, < 0 they owe me. */
  balanceAfter: number;
  transfer: UsdtTransfer;
  /** Borrowed USDT not yet matched by a repayment — its cost is only an estimate. */
  estimated: boolean;
}

export interface MerchantStatement {
  key: string;
  name: string;
  net: number;
  lastTs: number;
  lines: StatementLine[];
  monthGroups?: MonthGroup[];
}

export interface MonthGroup {
  yearMonth: string; // "2026-09" format
  lines: StatementLine[];
  netAtEnd: number;
}

/** One bank-statement-style ledger per merchant, oldest line first, with a running balance. */
export function buildMerchantStatements(transfers: UsdtTransfer[] | undefined): MerchantStatement[] {
  const byKey = new Map<string, UsdtTransfer[]>();
  for (const t of transfers || []) {
    if (!isTransferActive(t)) continue;
    const key = transferCounterpartyKey(t);
    const list = byKey.get(key) || [];
    list.push(t);
    byKey.set(key, list);
  }
  const out: MerchantStatement[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.ts - b.ts || a.createdAt - b.createdAt);
    let net = 0;
    // Borrowed amounts still waiting for a repayment, oldest first.
    const unpaid: { id: string; left: number }[] = [];
    const lines: StatementLine[] = list.map(t => {
      const qty = Number(t.amountUSDT);
      if (t.kind === 'borrow_in') {
        net += qty;
        unpaid.push({ id: t.id, left: qty });
      } else if (t.kind === 'lend_return') {
        net += qty;
      } else if (t.kind === 'borrow_repay') {
        net -= qty;
        let left = qty;
        while (left > EPS && unpaid.length) {
          const u = unpaid[0];
          const take = Math.min(left, u.left);
          u.left -= take;
          left -= take;
          if (u.left <= EPS) unpaid.shift();
        }
      } else {
        net -= qty;
      }
      return {
        id: t.id, groupId: t.groupId, ts: t.ts, kind: t.kind, direction: isTransferIn(t) ? 'in' : 'out',
        amount: qty, balanceAfter: round6(net), transfer: t, estimated: false,
      };
    });
    const stillUnpaid = new Set(unpaid.filter(u => u.left > EPS).map(u => u.id));
    for (const l of lines) if (stillUnpaid.has(l.id)) l.estimated = true;

    // Only include September (09) and later months, skip earlier months
    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-09`; // Start from September
    const septemberCutoff = new Date(currentDate.getFullYear(), 8, 1).getTime(); // September 1st of current year

    const filteredLines = lines.filter(line => line.ts >= septemberCutoff);

    // Group lines by month (only Sept onwards)
    const monthGroups = new Map<string, StatementLine[]>();
    for (const line of filteredLines) {
      const date = new Date(line.ts);
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthGroups.has(yearMonth)) monthGroups.set(yearMonth, []);
      monthGroups.get(yearMonth)!.push(line);
    }

    // Compute net at end of each month
    const groupArray: MonthGroup[] = [];
    let netAccum = 0;
    for (const [yearMonth, monthLines] of Array.from(monthGroups.entries()).sort()) {
      for (const line of monthLines) {
        netAccum = line.balanceAfter;
      }
      groupArray.push({ yearMonth, lines: monthLines, netAtEnd: round6(netAccum) });
    }

    out.push({
      key,
      name: list[list.length - 1].counterpartyName,
      net: round6(net),
      lastTs: list[list.length - 1].ts,
      lines,
      monthGroups: groupArray,
    });
  }
  return out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.lastTs - a.lastTs);
}
