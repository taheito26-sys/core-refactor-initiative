import type { Trade } from '../tracker-helpers';

export interface SplitOrderInput {
  trade: Trade;
  splitAmountUsdt: number;
  targetCustomerId: string;
  newTradeId: string;
  atRegistration?: boolean;
  /** Sell price for the split-off portion, when it differs from the original order's rate. Defaults to `trade.sellPriceQAR`. */
  secondSellPriceQAR?: number;
}

export interface SplitOrderResult {
  primaryTrade: Trade;
  secondTrade: Trade;
}

export type SplitOrderValidationError =
  | 'invalid_amount'
  | 'amount_too_large'
  | 'no_target_customer';

/**
 * Checks whether a split can proceed before any trade objects are built,
 * so both call sites (registering a new sale, editing an existing one) show
 * the same error for the same bad input instead of drifting apart.
 */
export function validateSplitOrder(
  splitAmountUsdt: number,
  totalAmountUsdt: number,
  targetCustomerId: string,
): SplitOrderValidationError | null {
  if (!(splitAmountUsdt > 0)) return 'invalid_amount';
  if (splitAmountUsdt >= totalAmountUsdt) return 'amount_too_large';
  if (!targetCustomerId) return 'no_target_customer';
  return null;
}

/**
 * Carves `splitAmountUsdt` off `trade` into a brand-new trade under
 * `targetCustomerId`, leaving the remainder on the original. Pure — callers
 * own picking the new trade's id (`newTradeId`) and applying the result to
 * tracker state. Rounds to 8 decimal places to avoid floating-point remainder
 * dust (e.g. 10 - 3.33333333 landing on 6.666666670000001).
 */
export function splitOrder({
  trade,
  splitAmountUsdt,
  targetCustomerId,
  newTradeId,
  atRegistration = false,
  secondSellPriceQAR,
}: SplitOrderInput): SplitOrderResult {
  const error = validateSplitOrder(splitAmountUsdt, trade.amountUSDT, targetCustomerId);
  if (error) {
    throw new Error(`splitOrder: ${error}`);
  }

  const remainderQty = Math.round((trade.amountUSDT - splitAmountUsdt) * 1e8) / 1e8;
  const suffix = atRegistration ? ' at registration' : '';
  const primaryNote = trade.note
    ? `${trade.note} — split: ${splitAmountUsdt} USDT moved to another customer${suffix}`
    : `Split off ${splitAmountUsdt} USDT to another customer${suffix}`;

  const primaryTrade: Trade = {
    ...trade,
    amountUSDT: remainderQty,
    note: primaryNote,
    revisions: atRegistration
      ? trade.revisions
      : [
          {
            at: Date.now(),
            before: {
              ts: trade.ts,
              amountUSDT: trade.amountUSDT,
              sellPriceQAR: trade.sellPriceQAR,
              customerId: trade.customerId,
              usesStock: trade.usesStock,
              feeQAR: trade.feeQAR,
              note: trade.note,
            },
          },
          ...trade.revisions,
        ].slice(0, 20),
  };

  const secondTrade: Trade = {
    ...trade,
    id: newTradeId,
    amountUSDT: splitAmountUsdt,
    customerId: targetCustomerId,
    sellPriceQAR: secondSellPriceQAR != null && secondSellPriceQAR > 0 ? secondSellPriceQAR : trade.sellPriceQAR,
    note: trade.note ? `${trade.note} (split from original order)` : 'Split from original order',
    revisions: [],
  };

  return { primaryTrade, secondTrade };
}
