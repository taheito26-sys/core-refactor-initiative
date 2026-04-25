import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  acceptCustomerQuote,
  getEligibleCustomerCashAccountsForOrder,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

function makeOrder(overrides: Partial<CustomerOrderRow> = {}): CustomerOrderRow {
  return {
    id: 'order-1',
    customer_user_id: 'customer-1',
    merchant_id: 'merchant-1',
    connection_id: 'connection-1',
    order_type: 'buy',
    amount: 1000,
    currency: 'QAR',
    rate: 0.25,
    total: 250,
    status: 'quoted',
    note: null,
    created_at: '2026-04-22T00:00:00.000Z',
    updated_at: '2026-04-22T00:00:00.000Z',
    confirmed_at: null,
    expires_at: null,
    payment_proof_url: null,
    payment_proof_uploaded_at: null,
    merchant_cash_account_id: null,
    merchant_cash_account_name: null,
    customer_cash_account_id: null,
    customer_cash_account_name: null,
    send_country: 'Qatar',
    receive_country: 'Egypt',
    send_currency: 'QAR',
    receive_currency: 'EGP',
    payout_rail: 'bank_transfer',
    corridor_label: 'Qatar -> Egypt',
    pricing_mode: 'merchant_quote',
    guide_rate: 0.25,
    guide_total: 250,
    guide_source: 'INSTAPAY_V1',
    guide_snapshot: null,
    guide_generated_at: '2026-04-22T00:00:00.000Z',
    final_rate: 0.25,
    final_total: 250,
    final_quote_note: null,
    quoted_by_user_id: 'merchant-user',
    customer_accepted_quote_at: null,
    customer_rejected_quote_at: null,
    quote_rejection_reason: null,
    market_pair: 'QAR/EGP',
    pricing_version: 'quote-flow-v1',
    ...overrides,
  };
}

describe('customer order acceptance', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('filters only eligible client-owned destination accounts', () => {
    const order = makeOrder({
      receive_currency: 'EGP',
      payout_rail: 'bank_transfer',
    });

    const eligible = getEligibleCustomerCashAccountsForOrder(order, [
      { id: 'egp-bank', currency: 'EGP', status: 'active', type: 'bank' },
      { id: 'qar-bank', currency: 'QAR', status: 'active', type: 'bank' },
      { id: 'inactive-egp', currency: 'EGP', status: 'inactive', type: 'bank' },
      { id: 'merchant-egp', currency: 'EGP', status: 'active', type: 'merchant_custody' },
    ]);

    expect(eligible.map((account) => account.id)).toEqual(['egp-bank']);
  });

  it('rejects acceptance without a destination cash account', async () => {
    const result = await acceptCustomerQuote(makeOrder(), 'customer-1', '');

    expect(result.error?.message).toContain('Destination cash account is required');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('accepts the quote with the selected destination cash account', async () => {
    rpcMock.mockResolvedValueOnce({ data: makeOrder(), error: null });

    const result = await acceptCustomerQuote(makeOrder(), 'customer-1', 'egp-bank');

    expect(rpcMock).toHaveBeenCalledWith('accept_customer_order_request', {
      p_order_id: 'order-1',
      p_customer_cash_account_id: 'egp-bank',
    });
    expect(result.error).toBeNull();
    expect(result.data?.customer_cash_account_id).toBeNull();
  });
});

