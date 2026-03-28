// ─── Monthly Settlement Decision Tests ──────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  calculateMonthlySettlement,
  resolveFinalDecision,
  buildMonthlySnapshot,
  type ProfitHandling,
} from '@/lib/trading/monthly-settlement';

describe('calculateMonthlySettlement', () => {
  it('correctly distributes when both reinvest', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'reinvest',
      lenderDecision: 'reinvest',
    });

    // operator fee = 2000, remaining = 8000
    // operator share = 8000 * 15000/40000 = 3000 → total = 5000
    // lender share = 8000 * 25000/40000 = 5000
    expect(result.calculation.operatorFee).toBe(2000);
    expect(result.calculation.operatorTotal).toBe(5000);
    expect(result.calculation.lenderTotal).toBe(5000);

    // Both reinvest
    expect(result.operator.reinvestedAmount).toBe(5000);
    expect(result.operator.withdrawnAmount).toBe(0);
    expect(result.operator.nextEffectiveCapital).toBe(20000);

    expect(result.lender.reinvestedAmount).toBe(5000);
    expect(result.lender.withdrawnAmount).toBe(0);
    expect(result.lender.nextEffectiveCapital).toBe(30000);
  });

  it('correctly handles mixed decisions (op reinvest, lender withdraw)', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'reinvest',
      lenderDecision: 'withdraw',
    });

    expect(result.operator.nextEffectiveCapital).toBe(20000); // 15k + 5k
    expect(result.lender.nextEffectiveCapital).toBe(25000);    // unchanged
    expect(result.lender.withdrawnAmount).toBe(5000);
  });

  it('correctly handles both withdraw', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'withdraw',
      lenderDecision: 'withdraw',
    });

    expect(result.operator.nextEffectiveCapital).toBe(15000);
    expect(result.lender.nextEffectiveCapital).toBe(25000);
    expect(result.operator.withdrawnAmount).toBe(5000);
    expect(result.lender.withdrawnAmount).toBe(5000);
  });

  it('handles zero gross profit', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 0,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'reinvest',
      lenderDecision: 'reinvest',
    });

    expect(result.operator.profitShare).toBe(0);
    expect(result.lender.profitShare).toBe(0);
    expect(result.operator.nextEffectiveCapital).toBe(15000);
    expect(result.lender.nextEffectiveCapital).toBe(25000);
  });

  it('handles equal contributions', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 15000,
      operatorDecision: 'reinvest',
      lenderDecision: 'withdraw',
    });

    // op fee = 2000, remaining = 8000, split 50/50
    expect(result.calculation.operatorTotal).toBe(6000); // 2000 + 4000
    expect(result.calculation.lenderTotal).toBe(4000);
    expect(result.operator.nextEffectiveCapital).toBe(21000); // 15k + 6k
    expect(result.lender.nextEffectiveCapital).toBe(15000);
  });
});

describe('resolveFinalDecision', () => {
  it('returns explicit decision when set', () => {
    expect(resolveFinalDecision('reinvest', 'withdraw')).toBe('reinvest');
    expect(resolveFinalDecision('withdraw', 'reinvest')).toBe('withdraw');
  });

  it('falls back to default when pending or null', () => {
    expect(resolveFinalDecision('pending', 'reinvest')).toBe('reinvest');
    expect(resolveFinalDecision(null, 'withdraw')).toBe('withdraw');
    expect(resolveFinalDecision(undefined, 'reinvest')).toBe('reinvest');
  });
});

describe('buildMonthlySnapshot', () => {
  it('produces an immutable snapshot with all required fields', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'reinvest',
      lenderDecision: 'withdraw',
    });

    const snapshot = buildMonthlySnapshot({
      agreementId: 'agr-1',
      agreementType: 'operator_priority',
      periodKey: '2026-03',
      operatorMerchantId: 'MRC-001',
      operatorRatio: 20,
      operatorEffectiveCapital: 15000,
      lenderEffectiveCapital: 25000,
      grossProfit: 10000,
      result,
    });

    expect(snapshot.agreement_type).toBe('operator_priority');
    expect(snapshot.operator_ratio).toBe(20);
    expect(snapshot.operator_fee).toBe(2000);
    expect(snapshot.operator_decision).toBe('reinvest');
    expect(snapshot.lender_decision).toBe('withdraw');
    expect(snapshot.operator_next_capital).toBe(20000);
    expect(snapshot.lender_next_capital).toBe(25000);
    expect(snapshot.finalized_at).toBeDefined();
  });

  it('snapshot is not affected by subsequent changes', () => {
    const result = calculateMonthlySettlement({
      grossProfit: 5000,
      operatorRatio: 10,
      operatorContribution: 10000,
      lenderContribution: 10000,
      operatorDecision: 'withdraw',
      lenderDecision: 'withdraw',
    });

    const snapshot = buildMonthlySnapshot({
      agreementId: 'agr-2',
      agreementType: 'operator_priority',
      periodKey: '2026-02',
      operatorMerchantId: 'MRC-002',
      operatorRatio: 10,
      operatorEffectiveCapital: 10000,
      lenderEffectiveCapital: 10000,
      grossProfit: 5000,
      result,
    });

    // Snapshot values are fixed
    expect(snapshot.gross_profit).toBe(5000);
    expect(snapshot.operator_reinvested).toBe(0);
    expect(snapshot.lender_reinvested).toBe(0);
    expect(snapshot.operator_next_capital).toBe(10000);
    expect(snapshot.lender_next_capital).toBe(10000);
  });
});

describe('multi-cycle effective capital', () => {
  it('reinvested profits compound into next cycle capital', () => {
    // Cycle 1: both reinvest
    const cycle1 = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: 15000,
      lenderContribution: 25000,
      operatorDecision: 'reinvest',
      lenderDecision: 'reinvest',
    });

    // Use cycle1 next-capital as cycle2 input
    const cycle2 = calculateMonthlySettlement({
      grossProfit: 10000,
      operatorRatio: 20,
      operatorContribution: cycle1.operator.nextEffectiveCapital, // 20000
      lenderContribution: cycle1.lender.nextEffectiveCapital,     // 30000
      operatorDecision: 'withdraw',
      lenderDecision: 'reinvest',
    });

    // Cycle2: op fee = 2000, remaining = 8000
    // op share = 8000 * 20000/50000 = 3200 → total = 5200
    // ln share = 8000 * 30000/50000 = 4800
    expect(cycle2.calculation.operatorTotal).toBe(5200);
    expect(cycle2.calculation.lenderTotal).toBe(4800);

    // Operator withdraws → capital stays at 20000
    expect(cycle2.operator.nextEffectiveCapital).toBe(20000);
    // Lender reinvests → 30000 + 4800 = 34800
    expect(cycle2.lender.nextEffectiveCapital).toBe(34800);
  });
});
