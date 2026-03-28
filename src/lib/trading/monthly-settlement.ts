// ─── Monthly Settlement Decision Logic ──────────────────────────────
// Pure functions for operator priority monthly profit handling workflow.
// No side effects — used by hooks and edge functions.

import { calculateOperatorPriorityProfit, type OperatorPriorityResult } from './operator-priority';

export type ProfitHandling = 'reinvest' | 'withdraw';

export interface MonthlySettlementInput {
  grossProfit: number;
  operatorRatio: number;
  operatorContribution: number;   // effective capital (base + reinvested)
  lenderContribution: number;     // effective capital (base + reinvested)
  operatorDecision: ProfitHandling;
  lenderDecision: ProfitHandling;
}

export interface MonthlySettlementResult {
  calculation: OperatorPriorityResult;
  operator: {
    profitShare: number;
    decision: ProfitHandling;
    reinvestedAmount: number;
    withdrawnAmount: number;
    nextEffectiveCapital: number;
  };
  lender: {
    profitShare: number;
    decision: ProfitHandling;
    reinvestedAmount: number;
    withdrawnAmount: number;
    nextEffectiveCapital: number;
  };
}

/**
 * Calculate the full monthly settlement result including next-cycle effective capital.
 */
export function calculateMonthlySettlement(input: MonthlySettlementInput): MonthlySettlementResult {
  const calc = calculateOperatorPriorityProfit({
    grossProfit: input.grossProfit,
    operatorRatio: input.operatorRatio,
    operatorContribution: input.operatorContribution,
    lenderContribution: input.lenderContribution,
  });

  const opReinvested = input.operatorDecision === 'reinvest' ? calc.operatorTotal : 0;
  const opWithdrawn = input.operatorDecision === 'withdraw' ? calc.operatorTotal : 0;
  const lnReinvested = input.lenderDecision === 'reinvest' ? calc.lenderTotal : 0;
  const lnWithdrawn = input.lenderDecision === 'withdraw' ? calc.lenderTotal : 0;

  return {
    calculation: calc,
    operator: {
      profitShare: calc.operatorTotal,
      decision: input.operatorDecision,
      reinvestedAmount: opReinvested,
      withdrawnAmount: opWithdrawn,
      nextEffectiveCapital: input.operatorContribution + opReinvested,
    },
    lender: {
      profitShare: calc.lenderTotal,
      decision: input.lenderDecision,
      reinvestedAmount: lnReinvested,
      withdrawnAmount: lnWithdrawn,
      nextEffectiveCapital: input.lenderContribution + lnReinvested,
    },
  };
}

/**
 * Resolve a merchant's final decision: explicit choice or fallback to default.
 */
export function resolveFinalDecision(
  explicitDecision: string | null | undefined,
  defaultBehavior: ProfitHandling,
): ProfitHandling {
  if (explicitDecision === 'reinvest' || explicitDecision === 'withdraw') {
    return explicitDecision;
  }
  return defaultBehavior;
}

/**
 * Build an immutable finalization snapshot for a monthly settlement.
 */
export function buildMonthlySnapshot(input: {
  agreementId: string;
  agreementType: string;
  periodKey: string;
  operatorMerchantId: string;
  operatorRatio: number;
  operatorEffectiveCapital: number;
  lenderEffectiveCapital: number;
  grossProfit: number;
  result: MonthlySettlementResult;
}): Record<string, unknown> {
  return {
    agreement_id: input.agreementId,
    agreement_type: input.agreementType,
    period_key: input.periodKey,
    operator_merchant_id: input.operatorMerchantId,
    operator_ratio: input.operatorRatio,
    operator_effective_capital: input.operatorEffectiveCapital,
    lender_effective_capital: input.lenderEffectiveCapital,
    gross_profit: input.grossProfit,
    operator_fee: input.result.calculation.operatorFee,
    remaining_profit: input.result.calculation.remainingProfit,
    operator_capital_share: input.result.calculation.operatorCapitalShare,
    lender_capital_share: input.result.calculation.lenderCapitalShare,
    operator_total: input.result.calculation.operatorTotal,
    lender_total: input.result.calculation.lenderTotal,
    operator_decision: input.result.operator.decision,
    lender_decision: input.result.lender.decision,
    operator_reinvested: input.result.operator.reinvestedAmount,
    operator_withdrawn: input.result.operator.withdrawnAmount,
    lender_reinvested: input.result.lender.reinvestedAmount,
    lender_withdrawn: input.result.lender.withdrawnAmount,
    operator_next_capital: input.result.operator.nextEffectiveCapital,
    lender_next_capital: input.result.lender.nextEffectiveCapital,
    finalized_at: new Date().toISOString(),
  };
}
