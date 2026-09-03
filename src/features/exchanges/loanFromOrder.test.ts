import { describe, it, expect } from 'vitest';
import { createLoanFromExchangeOrder, findUnlinkedCompletedSellOrders, DEFAULT_QAR_RATE } from './loanFromOrder';
import type { ExchangeP2POrder } from './types';
import type { CustomerLoan } from '@/lib/tracker-helpers';

function makeOrder(overrides: Partial<ExchangeP2POrder> = {}): ExchangeP2POrder {
  return {
    id: 'order-1',
    exchange: 'binance',
    order_number: '1234567890',
    side: 'sell',
    asset: 'USDT',
    fiat: 'EGP',
    amount: 100,
    price: 48.5,
    total: 4850,
    status: 'COMPLETED',
    counterparty: 'ahmed',
    order_time: '2026-08-01T10:00:00Z',
    linked_entity_type: null,
    linked_entity_id: null,
    linked_at: null,
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

describe('createLoanFromExchangeOrder', () => {
  it('multiplies the USDT amount by the given QAR rate for the principal', () => {
    const order = makeOrder({ amount: 100 });
    const loan = createLoanFromExchangeOrder(order, 'cust-1', 3.8);
    expect(loan).not.toBeNull();
    expect(loan!.principal).toBe(380);
  });

  it('rejects a non-completed order', () => {
    const order = makeOrder({ status: 'PENDING' });
    expect(createLoanFromExchangeOrder(order, 'cust-1', DEFAULT_QAR_RATE)).toBeNull();
  });

  it('rejects a buy order', () => {
    const order = makeOrder({ side: 'buy' });
    expect(createLoanFromExchangeOrder(order, 'cust-1', DEFAULT_QAR_RATE)).toBeNull();
  });

  it('round-trips the source exchange, order id and rate onto the loan', () => {
    const order = makeOrder({ id: 'order-42', exchange: 'binance' });
    const loan = createLoanFromExchangeOrder(order, 'cust-1', 3.9)!;
    expect(loan.sourceOrderId).toBe('order-42');
    expect(loan.sourceExchange).toBe('binance');
    expect(loan.qarRate).toBe(3.9);
    expect(loan.customerId).toBe('cust-1');
    expect(loan.currency).toBe('QAR');
    expect(loan.status).toBe('open');
  });
});

describe('findUnlinkedCompletedSellOrders', () => {
  it('excludes orders already linked to a loan', () => {
    const orders = [makeOrder({ id: 'a' }), makeOrder({ id: 'b' })];
    const loans = [{ sourceOrderId: 'a' } as CustomerLoan];
    const result = findUnlinkedCompletedSellOrders(orders, loans);
    expect(result.map(o => o.id)).toEqual(['b']);
  });

  it('excludes buy orders and non-completed orders', () => {
    const orders = [
      makeOrder({ id: 'a', side: 'buy' }),
      makeOrder({ id: 'b', status: 'PENDING' }),
      makeOrder({ id: 'c' }),
    ];
    const result = findUnlinkedCompletedSellOrders(orders, []);
    expect(result.map(o => o.id)).toEqual(['c']);
  });
});
