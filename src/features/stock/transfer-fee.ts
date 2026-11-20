// ─── Network / transfer fees on a USDT move ───
//
// A fee paid in USDT to move USDT (a send to a merchant, a loan out) leaves
// stock at cost and is a real expense. It is booked as an order with no
// revenue that consumes stock through FIFO, so stock, cost and profit stay
// consistent without any special-case accounting, and it is tied to the move
// it belongs to so undoing the move takes the fee with it.

import { computeFIFO, type TrackerState, type Trade } from '@/lib/tracker-helpers';

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class TransferFeeError extends Error {
  constructor(public code: 'bad_amount' | 'insufficient_stock') {
    super(code);
  }
}

/** Adds the fee for the move `feeOf`. A zero or empty fee changes nothing. */
export function withTransferFee(
  state: TrackerState,
  input: { feeUSDT: number; feeOf: string; counterpartyName: string; ts: number; id: string },
): TrackerState {
  const fee = round6(input.feeUSDT);
  if (!(fee > 0)) return state;
  if (!Number.isFinite(fee)) throw new TransferFeeError('bad_amount');
  if ((state.trades || []).some(t => t.id === input.id)) return state;
  const trade: Trade = {
    id: input.id,
    // One millisecond after the move, so the fee is always costed after it.
    ts: input.ts + 1,
    inputMode: 'USDT',
    amountUSDT: fee,
    sellPriceQAR: 0,
    feeQAR: 0,
    note: `Network fee — ${input.counterpartyName}`,
    voided: false,
    usesStock: true,
    revisions: [],
    customerId: '',
    buyerType: 'merchant',
    exchangeCounterparty: input.counterpartyName,
    transferFeeOf: input.feeOf,
  };
  const next: TrackerState = { ...state, trades: [...(state.trades || []), trade] };
  const calc = computeFIFO(next.batches, next.trades, next.usdtTransfers).tradeCalc.get(input.id);
  if (!calc || calc.shortfallQty > 1e-6) throw new TransferFeeError('insufficient_stock');
  return next;
}

/** Voids the fees tied to these moves; the fee order stays on record, as every voided order does. */
export function voidTransferFees(state: TrackerState, moveIds: string[]): TrackerState {
  const ids = new Set(moveIds);
  if (!(state.trades || []).some(t => t.transferFeeOf && ids.has(t.transferFeeOf) && !t.voided)) return state;
  return { ...state, trades: state.trades.map(t => (t.transferFeeOf && ids.has(t.transferFeeOf) && !t.voided ? { ...t, voided: true } : t)) };
}
