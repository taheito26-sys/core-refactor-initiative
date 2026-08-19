import { describe, it, expect } from 'vitest';
import { syncOrderLoan, findOrderLoan } from './orderLoan';
import type { TrackerState, CustomerLoan } from '@/lib/tracker-helpers';

const TRADE_ID = 'trade-1';

function makeState(over: Partial<TrackerState> = {}): TrackerState {
  return {
    currency: 'QAR',
    range: 'all',
    batches: [],
    trades: [],
    customers: [],
    suppliers: [],
    cashQAR: 0,
    cashOwner: '',
    cashHistory: [],
    cashAccounts: [],
    cashLedger: [],
    customerLoans: [],
    deletedLoanIds: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 },
    cal: { year: 2026, month: 0, selectedDay: null },
    ...over,
  };
}

function makeLoan(over: Partial<CustomerLoan> = {}): CustomerLoan {
  return {
    id: 'loan-1',
    ts: 1000,
    customerId: 'cust-1',
    tradeId: TRADE_ID,
    principal: 5000,
    currency: 'QAR',
    note: 'Loan from order — 1,000 USDT @ 5.00',
    repayments: [],
    status: 'open',
    createdAt: 1000,
    ...over,
  };
}

const baseInput = {
  tradeId: TRADE_ID,
  customerId: 'cust-1',
  ts: 2000,
  amountUSDT: 1000,
  sell: 4,
  fee: 100,
  currency: 'QAR' as const,
  note: 'Loan from order — 1,000 USDT @ 4.00',
  now: 5000,
  newId: () => 'loan-new',
};

describe('syncOrderLoan', () => {
  it('does nothing when the order is not loaned and never was', () => {
    const state = makeState();
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: false });
    expect(res.outcome).toBe('unchanged');
    expect(res.state).toBe(state);
  });

  it('creates a loan for the order total net of fee', () => {
    const res = syncOrderLoan({ ...baseInput, nextState: makeState(), isLoan: true });
    expect(res.outcome).toBe('created');
    expect(res.state.customerLoans).toHaveLength(1);
    expect(res.state.customerLoans![0]).toMatchObject({
      id: 'loan-new',
      tradeId: TRADE_ID,
      customerId: 'cust-1',
      principal: 3900,
      currency: 'QAR',
      status: 'open',
      ts: 2000,
      createdAt: 5000,
    });
  });

  it('moves the amount owed when the order is corrected', () => {
    const state = makeState({ customerLoans: [makeLoan()] });
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true });
    expect(res.outcome).toBe('updated');
    expect(res.state.customerLoans![0]).toMatchObject({
      id: 'loan-1',
      principal: 3900,
      ts: 2000,
      note: baseInput.note,
    });
  });

  it('reports unchanged when the correction leaves the loan identical', () => {
    const loan = makeLoan({ principal: 3900, ts: 2000, note: baseInput.note });
    const state = makeState({ customerLoans: [loan] });
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true });
    expect(res.outcome).toBe('unchanged');
    expect(res.state).toBe(state);
  });

  it('keeps a hand-written note but still moves the principal', () => {
    const loan = makeLoan({ note: 'Pays after payday' });
    const state = makeState({ customerLoans: [loan] });
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true });
    expect(res.state.customerLoans![0].note).toBe('Pays after payday');
    expect(res.state.customerLoans![0].principal).toBe(3900);
  });

  it('closes the loan when a correction drops the principal to what was repaid', () => {
    const loan = makeLoan({
      principal: 10000,
      repayments: [{ id: 'r1', ts: 1500, amount: 4000 }],
    });
    const state = makeState({ customerLoans: [loan] });
    // Still owed: principal 4,100 against 4,000 repaid.
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true, amountUSDT: 1000, sell: 4.2, fee: 100 });
    expect(res.state.customerLoans![0]).toMatchObject({ principal: 4100, status: 'open' });

    // Corrected down to exactly what was repaid — nothing left owing.
    const settled = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true, amountUSDT: 1000, sell: 4.1, fee: 100 });
    expect(settled.state.customerLoans![0]).toMatchObject({ principal: 4000, status: 'closed' });
  });

  it('removes and tombstones the loan when the order is un-marked', () => {
    const state = makeState({ customerLoans: [makeLoan()], deletedLoanIds: ['old-loan'] });
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: false });
    expect(res.outcome).toBe('removed');
    expect(res.state.customerLoans).toEqual([]);
    expect(res.state.deletedLoanIds).toEqual(['old-loan', 'loan-1']);
  });

  it('reverses ledger entries the loan produced when it is removed', () => {
    const state = makeState({
      customerLoans: [makeLoan({
        disbursementLedgerEntryId: 'led-1',
        repayments: [{ id: 'r1', ts: 1500, amount: 400, ledgerEntryId: 'led-2' }],
      })],
      cashAccounts: [{ id: 'acc-1', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }],
      cashLedger: [
        { id: 'led-1', ts: 1000, type: 'withdrawal', accountId: 'acc-1', direction: 'out', amount: 5000, currency: 'QAR' },
        { id: 'led-2', ts: 1500, type: 'deposit', accountId: 'acc-1', direction: 'in', amount: 400, currency: 'QAR' },
        { id: 'led-3', ts: 1600, type: 'deposit', accountId: 'acc-1', direction: 'in', amount: 900, currency: 'QAR' },
      ],
    });
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: false });
    expect(res.state.cashLedger!.map(e => e.id)).toEqual(['led-3']);
    expect(res.state.cashQAR).toBe(900);
  });

  it('ignores a tombstoned loan when looking up the order', () => {
    const state = makeState({ customerLoans: [makeLoan()], deletedLoanIds: ['loan-1'] });
    expect(findOrderLoan(state, TRADE_ID)).toBeUndefined();
    const res = syncOrderLoan({ ...baseInput, nextState: state, isLoan: true });
    expect(res.outcome).toBe('created');
    expect(res.state.customerLoans!.map(l => l.id)).toEqual(['loan-1', 'loan-new']);
  });
});
