/**
 * Validation functions for the Parent Order Fulfillment feature.
 *
 * All functions are pure — no side effects, no I/O.
 */

import type { CashAccount } from './types';
import type { CashAccountValidationResult } from './types';

// ── Task 5.1: Execution Insert Validation ────────────────────────────

/**
 * Validates a proposed order execution before it is inserted.
 *
 * Checks (in order):
 * 1. `sold_qar_amount` must be > 0
 * 2. `fx_rate_qar_to_egp` must be > 0
 * 3. `sold_qar_amount` must not exceed the remaining unfulfilled amount
 * 4. `egp_received_amount` must equal `sold_qar_amount × fx_rate_qar_to_egp` within ±0.001
 */
export function validateExecutionInsert(
  execution: {
    sold_qar_amount: number;
    fx_rate_qar_to_egp: number;
    egp_received_amount: number;
  },
  parentQarAmount: number,
  currentFulfilledQar: number,
): { valid: boolean; reason?: string } {
  if (execution.sold_qar_amount <= 0) {
    return { valid: false, reason: 'invalid_amount' };
  }

  if (execution.fx_rate_qar_to_egp <= 0) {
    return { valid: false, reason: 'invalid_rate' };
  }

  const remaining = parentQarAmount - currentFulfilledQar;
  if (execution.sold_qar_amount > remaining) {
    return { valid: false, reason: 'amount_exceeds_remaining' };
  }

  const expectedEgp = execution.sold_qar_amount * execution.fx_rate_qar_to_egp;
  if (Math.abs(execution.egp_received_amount - expectedEgp) > 0.001) {
    return { valid: false, reason: 'egp_mismatch' };
  }

  return { valid: true };
}

// ── Task 6.1: Cash Account Acceptance Validation ─────────────────────

/**
 * Validates that a selected cash account is eligible to receive EGP proceeds
 * when a customer accepts an order.
 *
 * Checks (in order):
 * 1. `accountId` must be non-null and non-empty
 * 2. The account must exist in the provided `accounts` list (ownership check)
 * 3. The account's currency must match `expectedCurrency`
 * 4. The account must be active
 */
export function validateCashAccountForAcceptance(
  accountId: string | null,
  userId: string,
  expectedCurrency: string,
  accounts: CashAccount[],
): CashAccountValidationResult {
  if (accountId === null || accountId === '') {
    return { valid: false, reason: 'no_account_selected' };
  }

  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    return { valid: false, reason: 'wrong_owner' };
  }

  if (account.currency !== expectedCurrency) {
    return { valid: false, reason: 'currency_mismatch' };
  }

  if (account.status !== 'active') {
    return { valid: false, reason: 'account_disabled' };
  }

  return { valid: true };
}
