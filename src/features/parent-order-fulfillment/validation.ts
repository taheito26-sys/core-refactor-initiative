/**
 * Validation functions for the Parent Order Fulfillment feature.
 * Updated for USDT-based phased order model.
 *
 * All functions are pure — no side effects, no I/O.
 */

import type { CashAccount } from './types';
import type { CashAccountValidationResult } from './types';

// ── Phase Entry Validation (USDT-based) ──────────────────────────────

/**
 * Validates a proposed phase entry before it is inserted.
 *
 * Inputs: executed_egp, egp_per_usdt
 * Checks overfill in USDT space: phase_usdt must not exceed remaining_usdt.
 */
export function validatePhaseInsert(
  phase: {
    executed_egp: number;
    egp_per_usdt: number;
  },
  requiredUsdt: number,
  currentFulfilledUsdt: number,
): { valid: boolean; reason?: string } {
  if (phase.executed_egp == null || isNaN(phase.executed_egp) || phase.executed_egp <= 0) {
    return { valid: false, reason: 'invalid_amount' };
  }

  if (phase.egp_per_usdt == null || isNaN(phase.egp_per_usdt) || phase.egp_per_usdt <= 0) {
    return { valid: false, reason: 'invalid_rate' };
  }

  const phaseUsdt = phase.executed_egp / phase.egp_per_usdt;
  const remainingUsdt = requiredUsdt - currentFulfilledUsdt;

  if (phaseUsdt > remainingUsdt + 0.01) {
    return { valid: false, reason: 'amount_exceeds_remaining' };
  }

  return { valid: true };
}

// ── Legacy: Execution Insert Validation (QAR-based, kept for compat) ─

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

// ── Cash Account Acceptance Validation ───────────────────────────────

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
