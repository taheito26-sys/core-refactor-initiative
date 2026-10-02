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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Carves `splitAmountUsdt` off `trade` into a brand-new trade under
 * `targetCustomerId`, leaving the remainder on the original. Pure — callers
 * own picking the new trade's id (`newTradeId`) and applying the result to
 * tracker state. Rounds to 8 decimal places to avoid floating-point remainder
 * dust (e.g. 10 - 3.33333333 landing on 6.666666670000001).
 *
 * The split-off trade is built field by field rather than spread from the
 * original: buyer-bound state (portal link, mirror status, linked partner
 * deal) belongs to the original buyer and must not follow the quantity to
 * the new one, while amount-bound state (fee, exchange fiat leg) is shared
 * out pro rata so the halves still add up to the original order.
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
  const ratio = splitAmountUsdt / trade.amountUSDT;
  const secondFee = round2((trade.feeQAR || 0) * ratio);
  const primaryFee = round2((trade.feeQAR || 0) - secondFee);
  const suffix = atRegistration ? ' at registration' : '';
  const primaryNote = trade.note
    ? `${trade.note} — split: ${splitAmountUsdt} USDT moved to another customer${suffix}`
    : `Split off ${splitAmountUsdt} USDT to another customer${suffix}`;

  const before = {
    ts: trade.ts,
    amountUSDT: trade.amountUSDT,
    sellPriceQAR: trade.sellPriceQAR,
    customerId: trade.customerId,
    usesStock: trade.usesStock,
    feeQAR: trade.feeQAR,
    note: trade.note,
  };

  const primaryTrade: Trade = {
    ...trade,
    amountUSDT: remainderQty,
    feeQAR: primaryFee,
    note: primaryNote,
    originalFiatAmount: trade.originalFiatAmount != null
      ? round2(trade.originalFiatAmount * (1 - ratio))
      : trade.originalFiatAmount,
    revisions: atRegistration
      ? trade.revisions
      : [{ at: Date.now(), before }, ...trade.revisions].slice(0, 20),
  };

  const secondTrade: Trade = {
    id: newTradeId,
    ts: trade.ts,
    inputMode: trade.inputMode,
    amountUSDT: splitAmountUsdt,
    sellPriceQAR: secondSellPriceQAR != null && secondSellPriceQAR > 0 ? secondSellPriceQAR : trade.sellPriceQAR,
    feeQAR: secondFee,
    note: trade.note ? `${trade.note} (split from original order)` : 'Split from original order',
    voided: false,
    usesStock: trade.usesStock,
    manualBuyPrice: trade.manualBuyPrice,
    customerId: targetCustomerId,
    splitFromTradeId: trade.id,
    importedFrom: trade.importedFrom,
    originalFiat: trade.originalFiat,
    originalFiatAmount: trade.originalFiatAmount != null ? round2(trade.originalFiatAmount * ratio) : undefined,
    originalFiatPriceUSDT: trade.originalFiatPriceUSDT,
    exchangeOrderNumber: trade.exchangeOrderNumber,
    exchangeCounterparty: trade.exchangeCounterparty,
    revisions: atRegistration ? [] : [{ at: Date.now(), splitFromTradeId: trade.id, before }],
  };

  return { primaryTrade, secondTrade };
}
