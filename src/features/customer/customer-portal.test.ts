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
    });

    expect(payload).not.toHaveProperty('corridor_label');
    expect(payload).not.toHaveProperty('payout_rail');
    expect(payload).not.toHaveProperty('quoted_at');
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
    const disallowed = [
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
      'market_pair',
      'pricing_version',
    ];

    for (const field of disallowed) {
      expect(ORDER_SELECT_FIELDS).not.toContain(field);
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
