/**
 * Aggregation logic for USDT-based parent order fulfillment.
 *
 * `computeParentSummary` is a pure function — no side effects, no I/O.
 * It derives a `ParentOrderSummary` from the parent order's USDT target
 * and the array of child phase snapshot rows.
 *
 * Progress is tracked as fulfilled_usdt / required_usdt.
 * Weighted avg FX = total_egp / total_consumed_qar (never a simple average).
 * All aggregates are derived from persisted phase snapshots only.
 */

import type { OrderExecution, ParentOrderSummary, FulfillmentStatus } from './types';

function deriveFulfillmentStatus(
  fulfilledUsdt: number,
  requiredUsdt: number,
): FulfillmentStatus {
  if (fulfilledUsdt === 0) return 'unfulfilled';
  if (fulfilledUsdt < requiredUsdt) return 'partially_fulfilled';
  return 'fully_fulfilled';
}

/**
 * Compute the aggregated summary for a parent order from its child phase snapshots.
 *
 * Only phases with `status === 'completed'` contribute to aggregates.
 */
export function computeParentSummary(
  parentOrderId: string,
  parentQarAmount: number,
  requiredUsdt: number,
  usdtQarRate: number,
  executions: OrderExecution[],
): ParentOrderSummary {
  let totalFulfilledUsdt = 0;
  let totalConsumedQar = 0;
  let totalEgp = 0;
  let fillCount = 0;

  for (const exec of executions) {
    if (exec.status === 'completed') {
      totalFulfilledUsdt += exec.phase_usdt ?? 0;
      totalConsumedQar += exec.phase_consumed_qar ?? 0;
      totalEgp += exec.executed_egp ?? 0;
      fillCount += 1;
    }
  }

  const remainingUsdt = Math.max(requiredUsdt - totalFulfilledUsdt, 0);
  const progressPercent = requiredUsdt > 0
    ? Math.min((totalFulfilledUsdt / requiredUsdt) * 100, 100)
    : 0;

  // Weighted avg FX = total_egp / total_consumed_qar (never simple average)
  const weightedAvgFx: number | null =
    fillCount > 0 && totalConsumedQar > 0 ? totalEgp / totalConsumedQar : null;

  const fulfillmentStatus = deriveFulfillmentStatus(totalFulfilledUsdt, requiredUsdt);

  return {
    parent_order_id: parentOrderId,
    parent_qar_amount: parentQarAmount,
    usdt_qar_rate: usdtQarRate,
    required_usdt: requiredUsdt,
    total_fulfilled_usdt: totalFulfilledUsdt,
    remaining_usdt: remainingUsdt,
    fulfilled_qar: totalConsumedQar,
    remaining_qar: Math.max(parentQarAmount - totalConsumedQar, 0),
    total_egp_received: totalEgp,
    fill_count: fillCount,
    progress_percent: progressPercent,
    weighted_avg_fx: weightedAvgFx,
    fulfillment_status: fulfillmentStatus,
  };
}
