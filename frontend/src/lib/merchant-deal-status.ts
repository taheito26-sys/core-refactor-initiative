// ─── Merchant Deal Status State Machine ─────────────────────────────
// Canonical statuses: pending, approved, rejected, cancelled
// Valid transitions:
//   pending  → approved | rejected | cancelled
//   approved → cancelled
//   rejected → (terminal)
//   cancelled → (terminal)

export type MerchantDealStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const DEAL_STATUS_TRANSITIONS: Record<MerchantDealStatus, readonly MerchantDealStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: [],
};

/**
 * Returns allowed next states for a given deal status.
 */
export function getAllowedDealStatusTransitions(status: MerchantDealStatus): MerchantDealStatus[] {
  return [...(DEAL_STATUS_TRANSITIONS[status] || [])];
}

/**
 * Normalizes a status string to MerchantDealStatus.
 * Maps known statuses; defaults unknown to 'pending'.
 */
export function normalizeDealStatus(status: string | null | undefined): MerchantDealStatus {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

/**
 * Returns true if the transition from current to next is valid.
 * Also returns true for idempotent transitions (current === next).
 */
export function canTransitionDealStatus(current: MerchantDealStatus, next: MerchantDealStatus): boolean {
  if (current === next) return true;
  return DEAL_STATUS_TRANSITIONS[current]?.includes(next) ?? false;
}

/**
 * Asserts that a status transition is valid. Throws if not.
 * @throws Error with message "Illegal merchant deal status transition: {current} -> {next}"
 */
export function assertDealStatusTransition(current: MerchantDealStatus, next: MerchantDealStatus): void {
  if (!canTransitionDealStatus(current, next)) {
    throw new Error(`Illegal merchant deal status transition: ${current} -> ${next}`);
  }
}
