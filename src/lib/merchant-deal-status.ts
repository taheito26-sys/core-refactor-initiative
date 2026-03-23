// ─── Merchant Deal Status State Machine ─────────────────────────────
// Only two statuses exist: pending and approved.
// The only valid forward transition is pending → approved.

export type MerchantDealStatus = 'pending' | 'approved';

export const DEAL_STATUS_TRANSITIONS: Record<MerchantDealStatus, readonly MerchantDealStatus[]> = {
  pending: ['approved'],
  approved: [],
};

/**
 * Returns allowed next states for a given deal status.
 * pending → [approved], approved → []
 */
export function getAllowedDealStatusTransitions(status: MerchantDealStatus): MerchantDealStatus[] {
  return [...(DEAL_STATUS_TRANSITIONS[status] || [])];
}

/**
 * Normalizes a status string to MerchantDealStatus.
 * Returns 'approved' if status === 'approved', else 'pending'.
 */
export function normalizeDealStatus(status: string | null | undefined): MerchantDealStatus {
  return status === 'approved' ? 'approved' : 'pending';
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
