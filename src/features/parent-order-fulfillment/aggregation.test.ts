/**
 * Unit tests for `computeParentSummary`.
 *
 * Progress is measured in USDT (fulfilled_usdt / required_usdt); the QAR and
 * EGP aggregates come from the persisted phase snapshot columns
 * (phase_usdt, phase_consumed_qar, executed_egp).
 *
 * Covers:
 *  1. No executions → unfulfilled, weighted_avg_fx = null, nothing fulfilled
 *  2. One partial phase → partially_fulfilled
 *  3. Canonical scenario (50,000 QAR across three phases)
 *  4. Overfill never makes a remaining amount negative
 *  5. Non-completed phases are excluded from all calculations
 *  6. Progress follows USDT, not QAR
 */

import { describe, it, expect } from 'vitest';
import { computeParentSummary } from './aggregation';
import type { OrderExecution } from './types';

// 50,000 QAR at 4 QAR per USDT → 12,500 USDT required.
const PARENT_QAR = 50_000;
const USDT_QAR_RATE = 4;
const REQUIRED_USDT = 12_500;

const summarize = (executions: OrderExecution[]) =>
  computeParentSummary('parent-1', PARENT_QAR, REQUIRED_USDT, USDT_QAR_RATE, executions);

/** Build a minimal valid phase snapshot, overriding only the fields a test cares about. */
function makeExecution(overrides: Partial<OrderExecution> & {
  id: string;
  sequence_number: number;
  phase_usdt: number;
  phase_consumed_qar: number;
  executed_egp: number;
  status: OrderExecution['status'];
}): OrderExecution {
  return {
    parent_order_id: 'parent-1',
    sold_qar_amount: overrides.phase_consumed_qar,
    fx_rate_qar_to_egp: overrides.phase_consumed_qar > 0 ? overrides.executed_egp / overrides.phase_consumed_qar : 0,
    egp_received_amount: overrides.executed_egp,
    egp_per_usdt: overrides.phase_usdt > 0 ? overrides.executed_egp / overrides.phase_usdt : 0,
    phase_qar_egp_fx: overrides.phase_consumed_qar > 0 ? overrides.executed_egp / overrides.phase_consumed_qar : 0,
    market_type: 'manual',
    cash_account_id: null,
    executed_at: '2024-01-01T00:00:00Z',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeParentSummary', () => {
  it('returns unfulfilled summary with null weighted_avg_fx when there are no executions', () => {
    const summary = summarize([]);

    expect(summary.parent_order_id).toBe('parent-1');
    expect(summary.parent_qar_amount).toBe(PARENT_QAR);
    expect(summary.usdt_qar_rate).toBe(USDT_QAR_RATE);
    expect(summary.required_usdt).toBe(REQUIRED_USDT);
    expect(summary.total_fulfilled_usdt).toBe(0);
    expect(summary.remaining_usdt).toBe(REQUIRED_USDT);
    expect(summary.fulfilled_qar).toBe(0);
    expect(summary.remaining_qar).toBe(PARENT_QAR);
    expect(summary.total_egp_received).toBe(0);
    expect(summary.fill_count).toBe(0);
    expect(summary.progress_percent).toBe(0);
    expect(summary.weighted_avg_fx).toBeNull();
    expect(summary.fulfillment_status).toBe('unfulfilled');
  });

  it('returns partially_fulfilled when one completed phase covers part of the parent', () => {
    const summary = summarize([
      makeExecution({ id: 'exec-1', sequence_number: 1, phase_usdt: 5_000, phase_consumed_qar: 20_000, executed_egp: 268_000, status: 'completed' }),
    ]);

    expect(summary.fulfillment_status).toBe('partially_fulfilled');
    expect(summary.total_fulfilled_usdt).toBe(5_000);
    expect(summary.remaining_usdt).toBe(7_500);
    expect(summary.fulfilled_qar).toBe(20_000);
    expect(summary.remaining_qar).toBe(30_000);
    expect(summary.total_egp_received).toBe(268_000);
    expect(summary.fill_count).toBe(1);
    expect(summary.progress_percent).toBe(40);
    expect(summary.weighted_avg_fx).toBeCloseTo(13.40, 10);
  });

  it('canonical scenario: 50,000 QAR across three phases → weighted_avg_fx = 13.385', () => {
    // Phase 1: 5,000 USDT = 20,000 QAR @ 13.40 → 268,000 EGP
    // Phase 2: 3,750 USDT = 15,000 QAR @ 13.55 → 203,250 EGP
    // Phase 3: 3,750 USDT = 15,000 QAR @ 13.20 → 198,000 EGP
    // Total EGP: 669,250  |  Total QAR: 50,000  →  669,250 / 50,000 = 13.385
    const summary = summarize([
      makeExecution({ id: 'exec-1', sequence_number: 1, phase_usdt: 5_000, phase_consumed_qar: 20_000, executed_egp: 268_000, status: 'completed' }),
      makeExecution({ id: 'exec-2', sequence_number: 2, phase_usdt: 3_750, phase_consumed_qar: 15_000, executed_egp: 203_250, status: 'completed' }),
      makeExecution({ id: 'exec-3', sequence_number: 3, phase_usdt: 3_750, phase_consumed_qar: 15_000, executed_egp: 198_000, status: 'completed' }),
    ]);

    expect(summary.fulfillment_status).toBe('fully_fulfilled');
    expect(summary.total_fulfilled_usdt).toBe(REQUIRED_USDT);
    expect(summary.remaining_usdt).toBe(0);
    expect(summary.fulfilled_qar).toBe(PARENT_QAR);
    expect(summary.remaining_qar).toBe(0);
    expect(summary.total_egp_received).toBe(669_250);
    expect(summary.fill_count).toBe(3);
    expect(summary.progress_percent).toBe(100);
    expect(summary.weighted_avg_fx).toBeCloseTo(13.385, 10);
  });

  it('remaining amounts and progress never go past their limits when a phase overfills', () => {
    const summary = summarize([
      makeExecution({ id: 'exec-1', sequence_number: 1, phase_usdt: 13_000, phase_consumed_qar: 52_000, executed_egp: 696_800, status: 'completed' }),
    ]);

    expect(summary.remaining_usdt).toBe(0);
    expect(summary.remaining_qar).toBe(0);
    expect(summary.progress_percent).toBe(100);
    expect(summary.fulfillment_status).toBe('fully_fulfilled');
  });

  it('excludes pending, cancelled, and failed phases from all calculations', () => {
    const phase = (id: string, n: number, status: OrderExecution['status'], usdt: number, qar: number, egp: number) =>
      makeExecution({ id, sequence_number: n, phase_usdt: usdt, phase_consumed_qar: qar, executed_egp: egp, status });

    const summary = summarize([
      phase('exec-completed', 1, 'completed', 2_500, 10_000, 135_000),
      phase('exec-pending', 2, 'pending', 3_750, 15_000, 204_000),
      phase('exec-cancelled', 3, 'cancelled', 1_250, 5_000, 66_500),
      phase('exec-failed', 4, 'failed', 2_000, 8_000, 107_600),
    ]);

    expect(summary.total_fulfilled_usdt).toBe(2_500);
    expect(summary.remaining_usdt).toBe(10_000);
    expect(summary.fulfilled_qar).toBe(10_000);
    expect(summary.total_egp_received).toBe(135_000);
    expect(summary.fill_count).toBe(1);
    expect(summary.remaining_qar).toBe(40_000);
    expect(summary.progress_percent).toBe(20);
    expect(summary.weighted_avg_fx).toBeCloseTo(13.50, 10);
    expect(summary.fulfillment_status).toBe('partially_fulfilled');
  });

  it('measures progress in USDT, not in QAR', () => {
    // 2,500 of 12,500 USDT is done, even though the QAR consumed looks nearly complete.
    const summary = summarize([
      makeExecution({ id: 'exec-1', sequence_number: 1, phase_usdt: 2_500, phase_consumed_qar: 49_000, executed_egp: 650_000, status: 'completed' }),
    ]);

    expect(summary.progress_percent).toBe(20);
    expect(summary.fulfillment_status).toBe('partially_fulfilled');
  });
});
