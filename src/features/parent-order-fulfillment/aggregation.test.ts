/**
 * Unit tests for `computeParentSummary`.
 *
 * Covers:
 *  1. No executions → unfulfilled, weighted_avg_fx = null, fulfilled_qar = 0
 *  2. One partial execution → partially_fulfilled
 *  3. Canonical scenario (50,000 QAR across three executions)
 *  4. Overfill is impossible (remaining_qar never goes negative)
 *  5. Non-completed executions are excluded from calculations
 */

import { describe, it, expect } from 'vitest';
import { computeParentSummary } from './aggregation';
import type { OrderExecution } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid OrderExecution, overriding only the fields you care about. */
function makeExecution(overrides: Partial<OrderExecution> & {
  id: string;
  sequence_number: number;
  sold_qar_amount: number;
  fx_rate_qar_to_egp: number;
  egp_received_amount: number;
  status: OrderExecution['status'];
}): OrderExecution {
  return {
    parent_order_id: 'parent-1',
    market_type: 'manual',
    cash_account_id: null,
    executed_at: '2024-01-01T00:00:00Z',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('computeParentSummary', () => {
  // ── Test 1: No executions ─────────────────────────────────────────────────
  it('returns unfulfilled summary with null weighted_avg_fx when there are no executions', () => {
    const summary = computeParentSummary('parent-1', 50_000, []);

    expect(summary.parent_order_id).toBe('parent-1');
    expect(summary.parent_qar_amount).toBe(50_000);
    expect(summary.fulfilled_qar).toBe(0);
    expect(summary.remaining_qar).toBe(50_000);
    expect(summary.total_egp_received).toBe(0);
    expect(summary.fill_count).toBe(0);
    expect(summary.progress_percent).toBe(0);
    expect(summary.weighted_avg_fx).toBeNull();
    expect(summary.fulfillment_status).toBe('unfulfilled');
    expect(summary.executions).toHaveLength(0);
  });

  // ── Test 2: One partial execution ─────────────────────────────────────────
  it('returns partially_fulfilled when one completed execution covers part of the parent', () => {
    const exec = makeExecution({
      id: 'exec-1',
      sequence_number: 1,
      sold_qar_amount: 20_000,
      fx_rate_qar_to_egp: 13.40,
      egp_received_amount: 268_000,
      status: 'completed',
    });

    const summary = computeParentSummary('parent-1', 50_000, [exec]);

    expect(summary.fulfillment_status).toBe('partially_fulfilled');
    expect(summary.fulfilled_qar).toBe(20_000);
    expect(summary.remaining_qar).toBe(30_000);
    expect(summary.total_egp_received).toBe(268_000);
    expect(summary.fill_count).toBe(1);
    expect(summary.progress_percent).toBe(40);
    expect(summary.weighted_avg_fx).toBeCloseTo(13.40, 10);
  });

  // ── Test 3: Canonical scenario ────────────────────────────────────────────
  it('canonical scenario: 50,000 QAR across three executions → weighted_avg_fx = 13.385', () => {
    // Execution 1: 20,000 QAR @ 13.40 → 268,000 EGP
    // Execution 2: 15,000 QAR @ 13.55 → 203,250 EGP
    // Execution 3: 15,000 QAR @ 13.20 → 198,000 EGP
    // Total EGP: 669,250  |  Total QAR: 50,000
    // Weighted avg FX: 669,250 / 50,000 = 13.385

    const executions: OrderExecution[] = [
      makeExecution({
        id: 'exec-1',
        sequence_number: 1,
        sold_qar_amount: 20_000,
        fx_rate_qar_to_egp: 13.40,
        egp_received_amount: 268_000,
        status: 'completed',
      }),
      makeExecution({
        id: 'exec-2',
        sequence_number: 2,
        sold_qar_amount: 15_000,
        fx_rate_qar_to_egp: 13.55,
        egp_received_amount: 203_250,
        status: 'completed',
      }),
      makeExecution({
        id: 'exec-3',
        sequence_number: 3,
        sold_qar_amount: 15_000,
        fx_rate_qar_to_egp: 13.20,
        egp_received_amount: 198_000,
        status: 'completed',
      }),
    ];

    const summary = computeParentSummary('parent-1', 50_000, executions);

    expect(summary.fulfillment_status).toBe('fully_fulfilled');
    expect(summary.fulfilled_qar).toBe(50_000);
    expect(summary.remaining_qar).toBe(0);
    expect(summary.total_egp_received).toBe(669_250);
    expect(summary.fill_count).toBe(3);
    expect(summary.progress_percent).toBe(100);
    // 669,250 / 50,000 = 13.385 exactly
    expect(summary.weighted_avg_fx).toBeCloseTo(13.385, 10);
    expect(summary.executions).toHaveLength(3);
  });

  // ── Test 4: Overfill is impossible ────────────────────────────────────────
  it('remaining_qar is never negative (overfill impossible by precondition)', () => {
    // The DB constraint prevents overfill; here we verify the pure function
    // correctly reflects a fully-filled state without going negative.
    const exec = makeExecution({
      id: 'exec-1',
      sequence_number: 1,
      sold_qar_amount: 50_000,
      fx_rate_qar_to_egp: 13.40,
      egp_received_amount: 670_000,
      status: 'completed',
    });

    const summary = computeParentSummary('parent-1', 50_000, [exec]);

    expect(summary.remaining_qar).toBe(0);
    expect(summary.remaining_qar).toBeGreaterThanOrEqual(0);
    expect(summary.fulfillment_status).toBe('fully_fulfilled');
  });

  // ── Test 5: Non-completed executions are excluded ─────────────────────────
  it('excludes pending, cancelled, and failed executions from all calculations', () => {
    const completedExec = makeExecution({
      id: 'exec-completed',
      sequence_number: 1,
      sold_qar_amount: 10_000,
      fx_rate_qar_to_egp: 13.50,
      egp_received_amount: 135_000,
      status: 'completed',
    });
    const pendingExec = makeExecution({
      id: 'exec-pending',
      sequence_number: 2,
      sold_qar_amount: 15_000,
      fx_rate_qar_to_egp: 13.60,
      egp_received_amount: 204_000,
      status: 'pending',
    });
    const cancelledExec = makeExecution({
      id: 'exec-cancelled',
      sequence_number: 3,
      sold_qar_amount: 5_000,
      fx_rate_qar_to_egp: 13.30,
      egp_received_amount: 66_500,
      status: 'cancelled',
    });
    const failedExec = makeExecution({
      id: 'exec-failed',
      sequence_number: 4,
      sold_qar_amount: 8_000,
      fx_rate_qar_to_egp: 13.45,
      egp_received_amount: 107_600,
      status: 'failed',
    });

    const summary = computeParentSummary('parent-1', 50_000, [
      completedExec,
      pendingExec,
      cancelledExec,
      failedExec,
    ]);

    // Only the completed execution should count
    expect(summary.fulfilled_qar).toBe(10_000);
    expect(summary.total_egp_received).toBe(135_000);
    expect(summary.fill_count).toBe(1);
    expect(summary.remaining_qar).toBe(40_000);
    expect(summary.progress_percent).toBe(20);
    expect(summary.weighted_avg_fx).toBeCloseTo(13.50, 10);
    expect(summary.fulfillment_status).toBe('partially_fulfilled');

    // But ALL four executions appear in the executions array
    expect(summary.executions).toHaveLength(4);
  });

  // ── Additional: executions are sorted by sequence_number ascending ─────────
  it('returns executions sorted by sequence_number ascending regardless of input order', () => {
    const exec3 = makeExecution({
      id: 'exec-3',
      sequence_number: 3,
      sold_qar_amount: 5_000,
      fx_rate_qar_to_egp: 13.20,
      egp_received_amount: 66_000,
      status: 'completed',
    });
    const exec1 = makeExecution({
      id: 'exec-1',
      sequence_number: 1,
      sold_qar_amount: 10_000,
      fx_rate_qar_to_egp: 13.40,
      egp_received_amount: 134_000,
      status: 'completed',
    });
    const exec2 = makeExecution({
      id: 'exec-2',
      sequence_number: 2,
      sold_qar_amount: 8_000,
      fx_rate_qar_to_egp: 13.55,
      egp_received_amount: 108_400,
      status: 'completed',
    });

    const summary = computeParentSummary('parent-1', 50_000, [exec3, exec1, exec2]);

    expect(summary.executions[0].sequence_number).toBe(1);
    expect(summary.executions[1].sequence_number).toBe(2);
    expect(summary.executions[2].sequence_number).toBe(3);
  });
});
