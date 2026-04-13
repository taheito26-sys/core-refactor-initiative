// ─── Trading Domain Types ───────────────────────────────────────────
// Agreement templates, merchant agreements, orders, and related types.

export type AgreementType = 'profit_share' | 'fixed_margin' | 'spread' | 'commission' | 'custom';
export type CalculationMethod = AgreementType;
export type MerchantAgreementStatus = 'pending' | 'approved' | 'rejected' | 'archived';
export type OrderDirection = 'incoming' | 'outgoing';
export type OrderStatus = 'draft' | 'confirmed' | 'cancelled' | 'archived';

// ─── Calculation Config ─────────────────────────────────────────────

export interface CalculationConfig {
  profitSharePercent?: number;
  fixedMarginAmount?: number;
  spreadPercent?: number;
  commissionPercent?: number;
  customFormulaLabel?: string;
  percentages?: Record<string, number>;
  fixedValues?: Record<string, number>;
  currencyAssumptions?: string[];
}

// ─── Agreement Snapshot (immutable, stored on orders) ───────────────

export interface AgreementSnapshot extends CalculationConfig {
  templateId: string;
  agreementId: string;
  version: number;
  agreementType: AgreementType;
}

// ─── Agreement Template ─────────────────────────────────────────────

export interface AgreementTemplate {
  id: string;
  name: string;
  agreementType: AgreementType;
  calculationMethod: CalculationMethod;
  calculationConfig: CalculationConfig;
  defaultCurrency: string;
  notes: string;
  createdByUserId: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Merchant Agreement ─────────────────────────────────────────────

export interface MerchantAgreement {
  id: string;
  templateId: string;
  merchantId: string;
  merchantName: string;
  agreementType: AgreementType;
  title: string;
  status: MerchantAgreementStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  resolvedTermsSnapshot: AgreementSnapshot;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Order ──────────────────────────────────────────────────────────

export interface Order {
  id: string;
  direction: OrderDirection;
  merchantId: string;
  merchantName: string;
  buyerId: string;
  buyerName: string;
  merchantAgreementId: string;
  agreementTemplateId: string;
  agreementType: AgreementType;
  agreementSnapshot: AgreementSnapshot;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  computedNetProfit: number;
  status: OrderStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Order Draft (for creating orders) ──────────────────────────────

export interface OrderDraft {
  direction: OrderDirection;
  merchantId: string;
  merchantName: string;
  buyerId: string;
  buyerName: string;
  merchantAgreementId: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  status?: OrderStatus;
}
