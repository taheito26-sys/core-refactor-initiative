// ─── Operator Priority Profit Share Calculation ─────────────────────
// Calculates profit distribution for the "Operator Priority" agreement type.
// The operator takes a fixed fee from gross profit FIRST, then the remaining
// profit is split by capital contribution weight.
//
// Formula:
//   operator_fee     = gross_profit × operator_ratio / 100
//   remaining_profit = gross_profit - operator_fee
//   total_capital    = operator_contribution + lender_contribution
//   operator_share   = remaining_profit × (operator_contribution / total_capital)
//   lender_share     = remaining_profit × (lender_contribution / total_capital)
//
// The operator's TOTAL = operator_fee + operator_share

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface OperatorPriorityInput {
  grossProfit: number;
  operatorRatio: number; // 0–100
  operatorContribution: number;
  lenderContribution: number;
}

export interface OperatorPriorityResult {
  grossProfit: number;
  operatorFee: number;
  remainingProfit: number;
  totalContribution: number;
  operatorWeightPct: number;
  lenderWeightPct: number;
  operatorCapitalShare: number;
  lenderCapitalShare: number;
  /** operator_fee + operatorCapitalShare */
  operatorTotal: number;
  lenderTotal: number;
}

/**
 * Calculate operator priority profit distribution.
 *
 * Edge cases:
 * - Zero or negative gross profit → all values are 0 (no negative fees)
 * - Zero total contribution → remaining profit stays with operator (100% weight)
 * - Invalid operator ratio → clamped to 0–100
 */
export function calculateOperatorPriorityProfit(input: OperatorPriorityInput): OperatorPriorityResult {
  const { grossProfit, operatorContribution, lenderContribution } = input;

  // Clamp operator ratio
  const operatorRatio = Math.max(0, Math.min(100, input.operatorRatio));

  // If no profit, return zeros
  if (grossProfit <= 0) {
    return {
      grossProfit: roundMoney(grossProfit),
      operatorFee: 0,
      remainingProfit: 0,
      totalContribution: roundMoney(operatorContribution + lenderContribution),
      operatorWeightPct: 0,
      lenderWeightPct: 0,
      operatorCapitalShare: 0,
      lenderCapitalShare: 0,
      operatorTotal: 0,
      lenderTotal: 0,
    };
  }

  const operatorFee = roundMoney(grossProfit * operatorRatio / 100);
  const remainingProfit = roundMoney(grossProfit - operatorFee);

  const totalContribution = operatorContribution + lenderContribution;

  let operatorWeightPct: number;
  let lenderWeightPct: number;
  let operatorCapitalShare: number;
  let lenderCapitalShare: number;

  if (totalContribution <= 0) {
    // Edge case: no contributions recorded → operator gets all remaining
    operatorWeightPct = 100;
    lenderWeightPct = 0;
    operatorCapitalShare = remainingProfit;
    lenderCapitalShare = 0;
  } else {
    operatorWeightPct = roundMoney((operatorContribution / totalContribution) * 100);
    lenderWeightPct = roundMoney((lenderContribution / totalContribution) * 100);
    operatorCapitalShare = roundMoney(remainingProfit * operatorContribution / totalContribution);
    lenderCapitalShare = roundMoney(remainingProfit - operatorCapitalShare); // avoid rounding drift
  }

  return {
    grossProfit: roundMoney(grossProfit),
    operatorFee,
    remainingProfit,
    totalContribution: roundMoney(totalContribution),
    operatorWeightPct,
    lenderWeightPct,
    operatorCapitalShare,
    lenderCapitalShare,
    operatorTotal: roundMoney(operatorFee + operatorCapitalShare),
    lenderTotal: lenderCapitalShare,
  };
}

/**
 * Build an immutable snapshot for an operator priority agreement.
 * Stored on orders/allocations for historical integrity.
 */
export interface OperatorPrioritySnapshot {
  agreement_type: 'operator_priority';
  operator_merchant_id: string;
  operator_ratio: number;
  operator_contribution: number;
  lender_contribution: number;
  total_contribution: number;
  operator_weight_pct: number;
  lender_weight_pct: number;
  partner_ratio: number;
  merchant_ratio: number;
  settlement_cadence: string;
}

export function buildOperatorPrioritySnapshot(agreement: {
  operator_merchant_id: string;
  operator_ratio: number;
  operator_contribution: number;
  lender_contribution: number;
  partner_ratio: number;
  merchant_ratio: number;
  settlement_cadence: string;
}): OperatorPrioritySnapshot {
  const total = agreement.operator_contribution + agreement.lender_contribution;
  return {
    agreement_type: 'operator_priority',
    operator_merchant_id: agreement.operator_merchant_id,
    operator_ratio: agreement.operator_ratio,
    operator_contribution: agreement.operator_contribution,
    lender_contribution: agreement.lender_contribution,
    total_contribution: total,
    operator_weight_pct: total > 0 ? roundMoney((agreement.operator_contribution / total) * 100) : 100,
    lender_weight_pct: total > 0 ? roundMoney((agreement.lender_contribution / total) * 100) : 0,
    partner_ratio: agreement.partner_ratio,
    merchant_ratio: agreement.merchant_ratio,
    settlement_cadence: agreement.settlement_cadence,
  };
}
