import { describe, expect, it } from 'vitest';
import { getAgreementLabel } from '@/lib/deal-engine';
import type { ProfitShareAgreement } from '@/types/domain';

const baseAgreement: ProfitShareAgreement = {
  id: 'a1',
  relationship_id: 'r1',
  partner_ratio: 40,
  merchant_ratio: 60,
  settlement_cadence: 'monthly',
  invested_capital: null,
  settlement_way: null,
  status: 'approved',
  effective_from: new Date().toISOString(),
  expires_at: null,
  created_by: 'u1',
  approved_by: 'u1',
  approved_at: new Date().toISOString(),
  notes: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  agreement_type: 'standard',
  operator_ratio: null,
  operator_merchant_id: null,
  operator_contribution: null,
  lender_contribution: null,
  terms_snapshot: null,
  operator_default_profit_handling: 'reinvest',
  counterparty_default_profit_handling: 'withdraw',
};

describe('getAgreementLabel', () => {
  it('includes shared standard fields when present', () => {
    const label = getAgreementLabel({
      ...baseAgreement,
      invested_capital: 5000,
      settlement_way: 'withdraw',
    });

    expect(label).toContain('Profit Share 40/60');
    expect(label).toContain('cap 5000');
    expect(label).toContain('withdraw');
  });

  it('handles legacy records with null shared fields', () => {
    const label = getAgreementLabel(baseAgreement);
    expect(label).toBe('Profit Share 40/60');
  });
});
