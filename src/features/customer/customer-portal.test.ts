import { describe, expect, it } from 'vitest';
import { buildCustomerOrderPayload, deriveFinalQuoteValues, extractMissingCustomerOrderColumn } from './customer-portal';

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
    expect(payload).toMatchObject({
      customer_user_id: 'user-1',
      merchant_id: 'merchant-1',
      connection_id: 'connection-1',
      send_country: 'Qatar',
      receive_country: 'Egypt',
    });
  });

  it('extracts missing customer-order columns from schema-cache errors', () => {
    expect(
      extractMissingCustomerOrderColumn({
        message: "Could not find the 'receive_country' column of 'customer_orders' in the schema cache",
      }),
    ).toBe('receive_country');
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
