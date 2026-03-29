// ─── Operator Priority Profit Share Tests ───────────────────────────
import { describe, it, expect } from 'vitest';
import {
  calculateOperatorPriorityProfit,
  buildOperatorPrioritySnapshot,
} from '@/lib/trading/operator-priority';

describe('calculateOperatorPriorityProfit', () => {
  it('equal contributions: 20% operator fee, 50/50 split', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 10_000,
      operatorRatio: 20,
      operatorContribution: 15_000,
      lenderContribution: 15_000,
    });

    expect(result.operatorFee).toBe(2_000);
    expect(result.remainingProfit).toBe(8_000);
    expect(result.operatorCapitalShare).toBe(4_000);
    expect(result.lenderCapitalShare).toBe(4_000);
    expect(result.operatorTotal).toBe(6_000);
    expect(result.lenderTotal).toBe(4_000);
  });

  it('unequal contributions: 20% fee, 15k vs 25k capital', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 10_000,
      operatorRatio: 20,
      operatorContribution: 15_000,
      lenderContribution: 25_000,
    });

    expect(result.operatorFee).toBe(2_000);
    expect(result.remainingProfit).toBe(8_000);
    expect(result.operatorCapitalShare).toBe(3_000);
    expect(result.lenderCapitalShare).toBe(5_000);
    expect(result.operatorTotal).toBe(5_000);
    expect(result.lenderTotal).toBe(5_000);
  });

  it('zero gross profit returns all zeros', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 0,
      operatorRatio: 20,
      operatorContribution: 10_000,
      lenderContribution: 10_000,
    });

    expect(result.operatorFee).toBe(0);
    expect(result.remainingProfit).toBe(0);
    expect(result.operatorTotal).toBe(0);
    expect(result.lenderTotal).toBe(0);
  });

  it('negative gross profit returns all zeros', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: -500,
      operatorRatio: 20,
      operatorContribution: 10_000,
      lenderContribution: 10_000,
    });

    expect(result.operatorFee).toBe(0);
    expect(result.operatorTotal).toBe(0);
    expect(result.lenderTotal).toBe(0);
  });

  it('zero contributions → operator gets all remaining', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 10_000,
      operatorRatio: 30,
      operatorContribution: 0,
      lenderContribution: 0,
    });

    expect(result.operatorFee).toBe(3_000);
    expect(result.remainingProfit).toBe(7_000);
    expect(result.operatorCapitalShare).toBe(7_000);
    expect(result.lenderCapitalShare).toBe(0);
    expect(result.operatorTotal).toBe(10_000);
  });

  it('operator ratio clamped to 0-100', () => {
    const over = calculateOperatorPriorityProfit({
      grossProfit: 1_000,
      operatorRatio: 150,
      operatorContribution: 5_000,
      lenderContribution: 5_000,
    });
    expect(over.operatorFee).toBe(1_000);
    expect(over.remainingProfit).toBe(0);

    const under = calculateOperatorPriorityProfit({
      grossProfit: 1_000,
      operatorRatio: -10,
      operatorContribution: 5_000,
      lenderContribution: 5_000,
    });
    expect(under.operatorFee).toBe(0);
    expect(under.remainingProfit).toBe(1_000);
  });

  it('100% operator ratio → entire profit is fee, no remaining', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 5_000,
      operatorRatio: 100,
      operatorContribution: 10_000,
      lenderContribution: 10_000,
    });

    expect(result.operatorFee).toBe(5_000);
    expect(result.remainingProfit).toBe(0);
    expect(result.operatorCapitalShare).toBe(0);
    expect(result.lenderCapitalShare).toBe(0);
    expect(result.operatorTotal).toBe(5_000);
    expect(result.lenderTotal).toBe(0);
  });

  it('handles fractional amounts with proper rounding', () => {
    const result = calculateOperatorPriorityProfit({
      grossProfit: 1_000,
      operatorRatio: 15,
      operatorContribution: 10_000,
      lenderContribution: 30_000,
    });

    expect(result.operatorFee).toBe(150);
    expect(result.remainingProfit).toBe(850);
    // 10k / 40k = 25% of 850 = 212.50
    expect(result.operatorCapitalShare).toBe(212.5);
    expect(result.lenderCapitalShare).toBe(637.5);
    expect(result.operatorTotal).toBe(362.5);
    expect(result.lenderTotal).toBe(637.5);
  });
});

describe('buildOperatorPrioritySnapshot', () => {
  it('creates immutable snapshot with weight calculations', () => {
    const snap = buildOperatorPrioritySnapshot({
      operator_merchant_id: 'MRC-OP001',
      operator_ratio: 20,
      operator_contribution: 15_000,
      lender_contribution: 25_000,
      partner_ratio: 50,
      merchant_ratio: 50,
      settlement_cadence: 'monthly',
    });

    expect(snap.agreement_type).toBe('operator_priority');
    expect(snap.operator_merchant_id).toBe('MRC-OP001');
    expect(snap.total_contribution).toBe(40_000);
    expect(snap.operator_weight_pct).toBe(37.5);
    expect(snap.lender_weight_pct).toBe(62.5);
  });

  it('snapshot is stable even with zero contributions', () => {
    const snap = buildOperatorPrioritySnapshot({
      operator_merchant_id: 'MRC-OP002',
      operator_ratio: 10,
      operator_contribution: 0,
      lender_contribution: 0,
      partner_ratio: 50,
      merchant_ratio: 50,
      settlement_cadence: 'weekly',
    });

    expect(snap.total_contribution).toBe(0);
    expect(snap.operator_weight_pct).toBe(100);
    expect(snap.lender_weight_pct).toBe(0);
  });
});
