import { describe, it, expect } from 'vitest';
import { applySplitOffFinancials, getSplitBlockReason } from '@/features/orders/utils/splitOrderFinancials';
import type { Trade, TrackerState } from '@/lib/tracker-helpers';

const second = {
  id: 't2', ts: 1, inputMode: 'USDT', amountUSDT: 100, sellPriceQAR: 4, feeQAR: 10, note: '',
  voided: false, usesStock: true, revisions: [], customerId: 'cb',
} as Trade;

const baseState = (over: Partial<TrackerState> = {}) =>
  ({ customerLoans: [], cashLedger: [], cashAccounts: [{ id: 'acc', currency: 'QAR', status: 'active', name: 'x' }], ...over }) as unknown as TrackerState;

describe('getSplitBlockReason', () => {
  it('blocks a linked partner deal', () => {
    expect(getSplitBlockReason(baseState(), { id: 't1', linkedDealId: 'd' })).toBe('linked_deal');
  });
  it('blocks a loan that already has repayments but allows an untouched one', () => {
    const loan = { id: 'l', tradeId: 't1', customerId: 'ca', principal: 100, currency: 'QAR', status: 'open', createdAt: 1, ts: 1 };
    const paid = { ...loan, repayments: [{ id: 'r', ts: 1, amount: 5 }] };
    expect(getSplitBlockReason(baseState({ customerLoans: [paid] as never }), { id: 't1' })).toBe('loan_has_repayments');
    expect(getSplitBlockReason(baseState({ customerLoans: [loan] as never }), { id: 't1' })).toBeNull();
  });
});

describe('applySplitOffFinancials', () => {
  it('creates a loan for the split-off amount net of its fee when the order is loaned', () => {
    const next = applySplitOffFinancials({
      nextState: baseState(), secondTrade: second, isLoan: true, depositRatio: 0,
      currency: 'QAR', loanNote: 'n', depositNote: 'd', newId: () => 'new',
    });
    expect(next.customerLoans).toHaveLength(1);
    expect(next.customerLoans![0]).toMatchObject({ customerId: 'cb', tradeId: 't2', principal: 390 });
  });

  it('deposits the same share of the split-off revenue as the original had', () => {
    const next = applySplitOffFinancials({
      nextState: baseState(), secondTrade: second, isLoan: false, depositRatio: 0.5,
      depositAccount: { accountId: 'acc', currency: 'QAR' },
      currency: 'QAR', loanNote: 'n', depositNote: 'd', newId: () => 'new',
    });
    expect(next.customerLoans).toHaveLength(0);
    expect(next.cashLedger).toHaveLength(1);
    expect(next.cashLedger![0]).toMatchObject({ type: 'sale_deposit', amount: 200, tradeId: 't2', direction: 'in' });
  });

  it('does nothing extra for a plain unpaid sale', () => {
    const state = baseState();
    expect(applySplitOffFinancials({
      nextState: state, secondTrade: second, isLoan: false, depositRatio: 0,
      currency: 'QAR', loanNote: 'n', depositNote: 'd',
    })).toBe(state);
  });
});
