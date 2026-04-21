import { describe, expect, it } from 'vitest';
import {
  ORDER_SELECT_FIELDS,
  buildCustomerOrderPayload,
  deriveFinalQuoteValues,
  extractMissingCustomerOrderColumn,
} from './customer-portal';

describe('customer portal order payload', () => {
  it('does not write corridor_label to customer_orders', () => {
    const payload = buildCustomerOrderPayload({
      customerUserId: 'user-1',
      merchantId: 'merchant-1',
      connectionId: 'connection-1',
      orderType: 'buy',
      amount: 100,
      rate: null,
      note: null,
      sendCountry: 'Qatar',
      receiveCountry: 'Egypt',
      sendCurrency: 'QAR',
      receiveCurrency: 'EGP',
      payoutRail: 'cash_pickup',
      corridorLabel: 'Qatar -> Egypt',
      merchantCashAccountId: 'cash-merchant-1',
      merchantCashAccountName: 'Main merchant cash',
      customerCashAccountId: 'cash-customer-1',
      customerCashAccountName: 'Client wallet',
    });

    expect(payload).not.toHaveProperty('corridor_label');
    expect(payload).toHaveProperty('merchant_cash_account_id', 'cash-merchant-1');
    expect(payload).toHaveProperty('merchant_cash_account_name', 'Main merchant cash');
    expect(payload).toHaveProperty('customer_cash_account_id', 'cash-customer-1');
    expect(payload).toHaveProperty('customer_cash_account_name', 'Client wallet');
    expect(payload).toMatchObject({
      customer_user_id: 'user-1',
      merchant_id: 'merchant-1',
      connection_id: 'connection-1',
      order_type: 'buy',
      amount: 100,
      currency: 'QAR',
    });
  });

  it('extracts missing customer-order columns from schema-cache errors', () => {
    expect(
      extractMissingCustomerOrderColumn({
        message: "Could not find the 'receive_country' column of 'customer_orders' in the schema cache",
      }),
    ).toBe('receive_country');
  });

  it('keeps the shared customer-order select list on stable core fields only', () => {
    const expected = [
      'send_country',
      'receive_country',
      'send_currency',
      'receive_currency',
      'payout_rail',
      'corridor_label',
      'pricing_mode',
      'guide_rate',
      'guide_total',
      'guide_source',
      'guide_snapshot',
      'guide_generated_at',
      'final_rate',
      'final_total',
      'final_quote_note',
      'quoted_at',
      'quoted_by_user_id',
      'customer_accepted_quote_at',
      'customer_rejected_quote_at',
      'quote_rejection_reason',
      'merchant_cash_account_id',
      'merchant_cash_account_name',
      'customer_cash_account_id',
      'customer_cash_account_name',
      'market_pair',
      'pricing_version',
    ];

    for (const field of expected) {
      expect(ORDER_SELECT_FIELDS).toContain(field);
    }
  });

  it('derives the missing quote value from the order amount', () => {
    expect(deriveFinalQuoteValues(52000, { finalRate: 13.8, finalTotal: null })).toEqual({
      finalRate: 13.8,
      finalTotal: 717600,
    });

    expect(deriveFinalQuoteValues(52000, { finalRate: null, finalTotal: 717600 })).toEqual({
      finalRate: 13.8,
      finalTotal: 717600,
    });
  });
});
