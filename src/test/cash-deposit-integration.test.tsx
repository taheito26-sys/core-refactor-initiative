import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { fireEvent, screen } from '@testing-library/dom';
import { applyOrderCashDeposit } from '@/features/orders/utils/cashDeposit';
import { CashManagement } from '@/features/stock/components/CashManagement';
import type { TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

function makeState(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    currency: 'QAR',
    range: 'all',
    batches: [],
    trades: [],
    customers: [],
    cashQAR: 0,
    cashOwner: 'owner',
    cashHistory: [],
    cashAccounts: [],
    cashLedger: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 },
    cal: { year: 2026, month: 2, selectedDay: null },
    ...overrides,
  };
}

describe('order cash deposit integration', () => {
  it('applies full deposit into selected active QAR account', () => {
    const state = makeState({
      cashAccounts: [
        { id: 'acc-1', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 },
      ],
    });
    const next = applyOrderCashDeposit({
      nextState: state,
      cashDepositMode: 'full',
      cashDepositAmountRaw: '',
      cashDepositAccountId: 'acc-1',
      sell: 3.5,
      amountUSDT: 100,
      note: 'sale',
      now: 1000,
    });

    expect(next.cashLedger).toHaveLength(1);
    expect(next.cashLedger[0]).toMatchObject({
      type: 'sale_deposit',
      accountId: 'acc-1',
      direction: 'in',
      amount: 350,
      currency: 'QAR',
    });
    expect(next.cashQAR).toBe(350);
  });

  it('applies partial deposit and caps at revenue', () => {
    const state = makeState({
      cashAccounts: [
        { id: 'acc-1', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 },
      ],
    });
    const next = applyOrderCashDeposit({
      nextState: state,
      cashDepositMode: 'partial',
      cashDepositAmountRaw: '1000',
      cashDepositAccountId: 'acc-1',
      sell: 2,
      amountUSDT: 100,
      note: 'sale',
      now: 1000,
    });

    expect(next.cashLedger).toHaveLength(1);
    expect(next.cashLedger[0].amount).toBe(200);
    expect(next.cashQAR).toBe(200);
  });

  it('falls back to first active QAR account when selected account is invalid', () => {
    const state = makeState({
      cashAccounts: [
        { id: 'acc-a', name: 'Primary', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 },
        { id: 'acc-b', name: 'USDT Wallet', type: 'vault', currency: 'USDT', status: 'active', createdAt: 1 },
      ],
    });
    const next = applyOrderCashDeposit({
      nextState: state,
      cashDepositMode: 'full',
      cashDepositAmountRaw: '',
      cashDepositAccountId: 'missing-account',
      sell: 1,
      amountUSDT: 50,
      note: 'sale',
      now: 1000,
    });

    expect(next.cashLedger[0].accountId).toBe('acc-a');
    expect(next.cashQAR).toBe(50);
  });

  it('auto-creates a QAR cash account when no active QAR account exists', () => {
    const state = makeState({
      cashQAR: 10,
      cashAccounts: [
        { id: 'acc-usdt', name: 'USDT', type: 'vault', currency: 'USDT', status: 'active', createdAt: 1 },
      ],
    });
    const next = applyOrderCashDeposit({
      nextState: state,
      cashDepositMode: 'partial',
      cashDepositAmountRaw: '25',
      cashDepositAccountId: 'acc-usdt',
      sell: 2,
      amountUSDT: 20,
      note: 'sale',
      now: 1000,
    });

    expect(next.cashAccounts.some(a => a.currency === 'QAR' && a.status === 'active')).toBe(true);
    expect(next.cashLedger).toHaveLength(1);
    expect(next.cashLedger[0].type).toBe('sale_deposit');
    expect(next.cashHistory).toHaveLength(1);
    expect(next.cashHistory[0].type).toBe('sale_deposit');
    expect(next.cashQAR).toBe(35);
  });
});

describe('cash management sale_deposit visibility', () => {
  it('renders sale_deposit rows and summary totals', () => {
    const state = makeState({
      cashAccounts: [
        { id: 'acc-1', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 1 },
      ],
      cashQAR: 150,
      cashLedger: [
        {
          id: 'entry-1',
          ts: 1000,
          type: 'sale_deposit',
          accountId: 'acc-1',
          direction: 'in',
          amount: 150,
          currency: 'QAR',
          note: 'Order sale',
        },
      ],
    });

    render(<CashManagement state={state} applyState={() => undefined} />);

    expect(screen.getAllByText('150').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('cashLedgerTab'));
    expect(screen.getAllByText('Sale deposit').length).toBeGreaterThan(0);
  });
});
