// ─── Trading Utilities ──────────────────────────────────────────────
// ID generation, snapshot creation, delete mode, and order building.

import type {
  AgreementTemplate,
  AgreementSnapshot,
  MerchantAgreement,
  Order,
  OrderDraft,
  CalculationConfig,
} from './types';
import { calculateNetProfit } from './profit-service';

/**
 * Creates a prefixed random ID.
 * Returns `${prefix}-${Math.random().toString(36).slice(2, 10)}`
 */
export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Checks if economic terms have changed between two configs.
 * Returns JSON.stringify(current) !== JSON.stringify(next)
 */
export function economicTermsChanged(
  current: CalculationConfig,
  next: CalculationConfig,
): boolean {
  return JSON.stringify(current) !== JSON.stringify(next);
}

/**
 * Creates an immutable agreement snapshot from a template.
 * Merges template.calculationConfig with overrides, adds templateId, agreementId, version, agreementType.
 */
export function createMerchantAgreementSnapshot(
  template: AgreementTemplate,
  agreementId: string,
  version: number,
  overrides?: Partial<CalculationConfig>,
): AgreementSnapshot {
  return {
    ...template.calculationConfig,
    ...overrides,
    templateId: template.id,
    agreementId,
    version,
    agreementType: template.agreementType,
  };
}

/**
 * Determines delete mode for a merchant agreement.
 * Returns 'archive' if agreement.id in usedAgreementIds, else 'delete'.
 */
export function getMerchantAgreementDeleteMode(
  agreement: MerchantAgreement,
  usedAgreementIds: Set<string>,
): 'archive' | 'delete' {
  return usedAgreementIds.has(agreement.id) ? 'archive' : 'delete';
}

/**
 * Builds an Order from an OrderDraft and its associated MerchantAgreement.
 *
 * Validates:
 * - Agreement must be approved and active
 * - agreement.merchantId must equal draft.merchantId
 *
 * Creates Order with immutable agreementSnapshot and calculated computedNetProfit.
 *
 * @throws Error("Agreement must be approved and active")
 * @throws Error("agreement.merchantId must equal draft.merchantId")
 */
export function buildOrderFromDraft(
  draft: OrderDraft,
  agreement: MerchantAgreement,
  userId: string,
): Order {
  // Validation
  if (agreement.status !== 'approved' || !agreement.isActive) {
    throw new Error('Agreement must be approved and active');
  }

  if (agreement.merchantId !== draft.merchantId) {
    throw new Error('agreement.merchantId must equal draft.merchantId');
  }

  const totalAmount = draft.quantity * draft.unitPrice;
  const snapshot = agreement.resolvedTermsSnapshot;

  const computedNetProfit = calculateNetProfit({
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    snapshot,
  });

  const now = new Date().toISOString();

  return {
    id: createId('ORD'),
    direction: draft.direction,
    merchantId: draft.merchantId,
    merchantName: draft.merchantName,
    buyerId: draft.buyerId,
    buyerName: draft.buyerName,
    merchantAgreementId: agreement.id,
    agreementTemplateId: agreement.templateId,
    agreementType: agreement.agreementType,
    agreementSnapshot: { ...snapshot },
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    totalAmount,
    currency: draft.currency,
    computedNetProfit,
    status: draft.status || 'confirmed',
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
}
