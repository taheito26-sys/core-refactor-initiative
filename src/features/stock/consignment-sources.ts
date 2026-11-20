// ─── Consignments made from, or settled by, exchange records ───
//
// A Binance/OKX transfer or P2P order that is really USDT sent to another
// merchant to sell is a consignment, not a sale, purchase or loan; and USDT
// that comes back unsold is a return of that consignment, not a purchase.
// These transforms classify an exchange record that way, reusing the loan
// tagging so the record leaves "needs a decision" and goes back there on undo.

import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';
import { isTransferActive, type UsdtTransfer } from '@/lib/usdt-transfers';
import { ConsignmentError, findConsignment, isConsignment, listConsignments } from './consignment';
import { loanSourceAmount, loanSourceDirection, type LoanSource } from './loan-ledger';
import { tagExchangeOrder, tagExchangeTransfer, untagTransfer, type TagResult } from './usdt-tagging';

const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function tagRecord(state: TrackerState, src: LoanSource, kind: 'lend_out' | 'lend_return', name: string, id: string, qty: number, now: number): TagResult {
  if (src.type === 'exchange_transfer') return tagExchangeTransfer(state, src.transfer, kind, name, id, now, qty);
  if (src.type === 'exchange_order') return tagExchangeOrder(state, src.order, kind, name, id, src.available, qty, now);
  throw new ConsignmentError('bad_amount');
}

function patchRow(result: TagResult, id: string, patch: Partial<UsdtTransfer>): TagResult {
  return { ...result, state: { ...result.state, usdtTransfers: (result.state.usdtTransfers || []).map(x => (x.id === id ? { ...x, ...patch } : x)) } };
}

/** An outgoing exchange record becomes USDT sent to a merchant to sell. */
export function consignFromRecord(
  state: TrackerState,
  src: LoanSource,
  input: { id: string; counterpartyName: string; relationshipId?: string; remoteId?: string; profitSharePct: number; amount?: number },
  now = Date.now(),
): TagResult {
  if (loanSourceDirection(src) !== 'out') throw new ConsignmentError('bad_amount');
  if (!(input.profitSharePct >= 0 && input.profitSharePct <= 100)) throw new ConsignmentError('bad_ratio');
  const qty = round6(input.amount ?? loanSourceAmount(src));
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  const tagged = tagRecord(state, src, 'lend_out', input.counterpartyName, input.id, qty, now);
  const result = patchRow(tagged, input.id, {
    relationshipId: input.relationshipId,
    consignment: { profitSharePct: input.profitSharePct, soldUSDT: 0, remoteId: input.remoteId },
  });
  // The send must be fully covered by stock, or the cost it carries would be a guess.
  const calc = computeFIFO(result.state.batches, result.state.trades, result.state.usdtTransfers).transferCalc.get(input.id);
  if (!calc || calc.shortfallQty > EPS || calc.coveredQty < qty - EPS || !(calc.unitCost && calc.unitCost > 0)) {
    throw new ConsignmentError('insufficient_stock');
  }
  return result;
}

/** Open consignments an incoming record could be the unsold return of. */
export function openConsignmentsFor(state: Pick<TrackerState, 'usdtTransfers'>, counterparty?: string | null) {
  const open = listConsignments(state).filter(c => c.status === 'open');
  const key = String(counterparty || '').trim().toLowerCase();
  return open.sort((a, b) => Number(b.counterpartyName.trim().toLowerCase() === key) - Number(a.counterpartyName.trim().toLowerCase() === key) || b.ts - a.ts);
}

/** An incoming exchange record becomes the unsold USDT of one consignment coming back, at its original cost. */
export function returnFromRecord(
  state: TrackerState,
  src: LoanSource,
  input: { consignmentId: string; returnId: string; amount?: number; remoteEventId?: string },
  now = Date.now(),
): TagResult {
  if (loanSourceDirection(src) !== 'in') throw new ConsignmentError('bad_amount');
  const c = findConsignment(state, input.consignmentId);
  if (!c) throw new ConsignmentError('not_found');
  const qty = round6(input.amount ?? loanSourceAmount(src));
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (qty > c.open + EPS) throw new ConsignmentError('exceeds_open');
  const tagged = tagRecord(state, src, 'lend_return', c.counterpartyName, input.returnId, qty, now);
  return patchRow(tagged, input.returnId, {
    relationshipId: c.relationshipId,
    consignmentId: c.id,
    remoteEventId: input.remoteEventId,
  });
}

/**
 * Take a consignment send or return back out and give its exchange record back
 * to "needs a decision". A send that already has sales or returns cannot be
 * taken out; undo those first.
 */
export function undoConsignmentRecord(state: TrackerState, transferId: string, now = Date.now()): TagResult {
  const row = (state.usdtTransfers || []).find(x => x.id === transferId && !x.voided);
  if (!row) throw new ConsignmentError('not_found');
  if (isConsignment(row)) {
    const hasReturns = (state.usdtTransfers || []).some(x => isTransferActive(x) && x.consignmentId === row.id);
    if ((row.consignment.soldUSDT || 0) > EPS || (row.consignment.shortUSDT || 0) > EPS || hasReturns) throw new ConsignmentError('exceeds_open');
  }
  return untagTransfer(state, transferId, now);
}
