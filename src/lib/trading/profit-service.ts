// ─── Profit Calculation Service ─────────────────────────────────────
// Calculates net profit based on agreement type and calculation config.

import type { AgreementSnapshot, AgreementType } from './types';

/**
 * Rounds money values to 2 decimal places.
 * Uses Math.round((value + Number.EPSILON) * 100) / 100
 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate net profit based on agreement type and snapshot config.
 *
 * | agreementType  | Formula                                                   |
 * |----------------|-----------------------------------------------------------|
 * | profit_share   | round(total * profitSharePercent / 100)                   |
 * | fixed_margin   | round(quantity * fixedMarginAmount)                       |
 * | spread         | round(total * spreadPercent / 100)                        |
 * | commission     | round(total * commissionPercent / 100)                    |
 * | custom         | round(sum(fixedValues) + total * sum(percentages) / 100)  |
 * | default        | 0                                                         |
 */
export function calculateNetProfit({
  quantity,
  unitPrice,
  snapshot,
}: {
  quantity: number;
  unitPrice: number;
  snapshot: AgreementSnapshot;
}): number {
  const total = quantity * unitPrice;

  switch (snapshot.agreementType) {
    case 'profit_share':
      return roundMoney(total * (snapshot.profitSharePercent ?? 0) / 100);

    case 'fixed_margin':
      return roundMoney(quantity * (snapshot.fixedMarginAmount ?? 0));

    case 'spread':
      return roundMoney(total * (snapshot.spreadPercent ?? 0) / 100);

    case 'commission':
      return roundMoney(total * (snapshot.commissionPercent ?? 0) / 100);

    case 'custom': {
      const fixedSum = snapshot.fixedValues
        ? Object.values(snapshot.fixedValues).reduce((s, v) => s + v, 0)
        : 0;
      const pctSum = snapshot.percentages
        ? Object.values(snapshot.percentages).reduce((s, v) => s + v, 0)
        : 0;
      return roundMoney(fixedSum + total * pctSum / 100);
    }

    default:
      return 0;
  }
}
