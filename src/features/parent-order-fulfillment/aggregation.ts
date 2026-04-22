/**
 * Aggregation logic for parent order fulfillment.
 *
 * `computeParentSummary` is a pure function — no side effects, no I/O.
 * It derives a `ParentOrderSummary` from a parent order ID, the parent's
 * target QAR amount, and the array of child `OrderExecution` rows.
 */

import type { OrderExecution, ParentOrderSummary, FulfillmentStatus } from './types';

/**
 * Derive the three-way fulfillment status from the fulfilled and parent amounts.
 *
 * Preconditions:
 *   - fulfilledQar >= 0
 *   - parentQarAmount > 0
 *   - fulfilledQar <= parentQarAmount  (overfill is impossible by DB constraint)
 */
function deriveFulfillmentStatus(
  fulfilledQar: number,
  parentQarAmount: number,
): FulfillmentStatus {
  if (fulfilledQar === 0) return 'unfulfilled';
  if (fulfilledQar < parentQarAmount) return 'partially_fulfilled';
  return 'fully_fulfilled';
}

/**
 * Compute the aggregated summary for a parent order from its child executions.
 *
 * Only executions with `status === 'completed'` contribute to the numeric
 * aggregates (fulfilled_qar, total_egp_received, fill_count, weighted_avg_fx,
 * progress_percent, fulfillment_status, remaining_qar).
 *
 * The returned `executions` array contains ALL executions (regardless of
 * status), sorted by `sequence_number` ascending.
 *
 * @param parentOrderId   - The parent order's UUID.
 * @param parentQarAmount - The target QAR amount for the parent order (> 0).
 * @param executions      - All child `OrderExecution` rows for this parent.
 * @returns               A fully-derived `ParentOrderSummary`.
 */
export function computeParentSummary(
  parentOrderId: string,
  parentQarAmount: number,
  executions: OrderExecution[],
): ParentOrderSummary {
  // ── 1. Aggregate over completed executions only ───────────────────────────
  let fulfilledQar = 0;
  let totalEgpReceived = 0;
  let fillCount = 0;

  for (const execution of executions) {
    if (execution.status === 'completed') {
      fulfilledQar += execution.sold_qar_amount;
      totalEgpReceived += execution.egp_received_amount;
      fillCount += 1;
    }
  }

  // ── 2. Derived scalars ────────────────────────────────────────────────────
  const remainingQar = parentQarAmount - fulfilledQar;
  const progressPercent = (fulfilledQar / parentQarAmount) * 100;

  // Weighted average FX: total EGP received divided by total QAR sold.
  // Returns null when there are no completed executions.
  const weightedAvgFx: number | null =
    fillCount > 0 ? totalEgpReceived / fulfilledQar : null;

  const fulfillmentStatus = deriveFulfillmentStatus(fulfilledQar, parentQarAmount);

  // ── 3. Sort all executions by sequence_number ascending ───────────────────
  const sortedExecutions = [...executions].sort(
    (a, b) => a.sequence_number - b.sequence_number,
  );

  return {
    parent_order_id: parentOrderId,
    parent_qar_amount: parentQarAmount,
    fulfilled_qar: fulfilledQar,
    remaining_qar: remainingQar,
    total_egp_received: totalEgpReceived,
    fill_count: fillCount,
    progress_percent: progressPercent,
    weighted_avg_fx: weightedAvgFx,
    fulfillment_status: fulfillmentStatus,
    executions: sortedExecutions,
  };
}
