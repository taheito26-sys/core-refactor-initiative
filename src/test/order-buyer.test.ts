import { describe, expect, it } from 'vitest';
import { assertSavedOrderBuyers, hasSavedOrderBuyer } from '@/features/orders/utils/order-buyer';
import type { Customer, Trade } from '@/lib/tracker-helpers';

const customer = { id: 'buyer', name: 'Mohamed Al-Damrawy' } as Customer;
const trade = { id: 'order', customerId: 'buyer', ts: 1, amountUSDT: 1785, sellPriceQAR: 3.83, feeQAR: 0, note: '', usesStock: true } as Trade;
const empty = { customers: [], trades: [] };

describe('saved order buyer requirement', () => {
  it('rejects a missing, stale, blank, or placeholder buyer', () => {
    for (const customerId of ['', 'missing']) {
      expect(() => assertSavedOrderBuyers(empty, { customers: [customer], trades: [{ ...trade, customerId }] })).toThrow('buyer');
    }
    for (const name of ['', '   ', '—', '-']) {
      expect(() => assertSavedOrderBuyers(empty, { customers: [{ ...customer, name }], trades: [trade] })).toThrow('buyer');
    }
  });
  it('requires the customer record, even when a portal account was stamped on the order', () => {
    expect(() => assertSavedOrderBuyers(empty, { customers: [], trades: [{ ...trade, connectedCustomerId: 'portal-user' }] })).toThrow();
  });
  it('accepts an explicitly saved buyer and allows recording both split halves for saved buyers', () => {
    const second = { ...customer, id: 'buyer-2', name: 'Second buyer' };
    expect(() => assertSavedOrderBuyers(empty, { customers: [customer, second], trades: [trade, { ...trade, id: 'split', customerId: second.id }] })).not.toThrow();
    expect(hasSavedOrderBuyer([customer], customer.id)).toBe(true);
    expect(() => assertSavedOrderBuyers(empty, { customers: [customer], trades: [trade, { ...trade, id: 'split', customerId: second.id }] })).toThrow();
  });
  it('blocks removing the buyer record or clearing the buyer on an existing valid order', () => {
    const previous = { customers: [customer], trades: [trade] };
    expect(() => assertSavedOrderBuyers(previous, { ...previous, customers: [] })).toThrow();
    expect(() => assertSavedOrderBuyers(previous, { ...previous, trades: [{ ...trade, customerId: '' }] })).toThrow();
  });
  it('does not block unrelated work for legacy rows, but requires a buyer when correcting them', () => {
    const orphan = { ...trade, customerId: 'missing' };
    const previous = { customers: [], trades: [orphan] };
    expect(() => assertSavedOrderBuyers(previous, { ...previous, trades: [{ ...orphan }] })).not.toThrow();
    expect(() => assertSavedOrderBuyers(previous, { ...previous, trades: [{ ...orphan, sellPriceQAR: 4 }] })).toThrow();
    expect(() => assertSavedOrderBuyers(previous, { customers: [customer], trades: [trade] })).not.toThrow();
  });
  it('allows cancelling a legacy order and does not treat capital transfers as customer orders', () => {
    expect(() => assertSavedOrderBuyers(empty, { customers: [], trades: [{ ...trade, voided: true }] })).not.toThrow();
    expect(() => assertSavedOrderBuyers(empty, { customers: [], trades: [{ ...trade, agreementFamily: 'capital_transfer' }] })).not.toThrow();
  });
});
