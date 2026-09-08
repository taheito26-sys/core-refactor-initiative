import { describe, it, expect } from 'vitest';
import { mergeCustomerRecords, type Customer, type Trade, type CustomerLoan } from '@/lib/tracker-helpers';

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return { id: 'c1', name: 'Mohamed Al-Damrawy', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 0, ...overrides };
}

function mockTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1', ts: 0, amountUSDT: 1, sellPriceQAR: 1, feeQAR: 0, note: '', voided: false, usesStock: false,
    revisions: [], customerId: 'c1', ...overrides,
  } as Trade;
}

function mockLoan(overrides: Partial<CustomerLoan> = {}): CustomerLoan {
  return { id: 'l1', ts: 0, customerId: 'c1', principal: 100, currency: 'QAR', status: 'open', createdAt: 0, ...overrides };
}

describe('mergeCustomerRecords', () => {
  it('repoints trades and loans from the duplicate id onto the canonical id', () => {
    const state = {
      customers: [mockCustomer({ id: 'local-1' }), mockCustomer({ id: 'connected-1' })],
      trades: [mockTrade({ id: 't1', customerId: 'local-1' }), mockTrade({ id: 't2', customerId: 'connected-1' })],
      customerLoans: [mockLoan({ id: 'l1', customerId: 'local-1' })],
    };

    const merged = mergeCustomerRecords(state, 'local-1', 'connected-1');

    expect(merged.customers.map(c => c.id)).toEqual(['connected-1']);
    expect(merged.trades.every(t => t.customerId === 'connected-1')).toBe(true);
    expect(merged.customerLoans?.every(l => l.customerId === 'connected-1')).toBe(true);
  });

  it('is a no-op when the ids match or either is empty', () => {
    const state = {
      customers: [mockCustomer({ id: 'c1' })],
      trades: [mockTrade({ id: 't1', customerId: 'c1' })],
      customerLoans: [mockLoan({ id: 'l1', customerId: 'c1' })],
    };

    expect(mergeCustomerRecords(state, 'c1', 'c1')).toBe(state);
    expect(mergeCustomerRecords(state, '', 'c1')).toBe(state);
    expect(mergeCustomerRecords(state, 'c1', '')).toBe(state);
  });
});
