import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';
import type { TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});

const pending: PendingExchangeItem[] = [{
  key: 't:inbox-1',
  source: 'transfer',
  exchange: 'binance',
  direction: 'out',
  ts: Date.parse('2026-11-19T08:00:00Z'),
  pendingUSDT: 10000,
  effect: 10000,
  counterparty: 'E2E Receiver',
  reference: 'E2E-INBOX-REF',
  transfer: {
    id: 'inbox-1',
    exchange: 'binance',
    direction: 'out',
    asset: 'USDT',
    amount: 10000,
    kind: 'pay',
    reference: 'E2E-INBOX-REF',
    counterparty: 'E2E Receiver',
    transfer_time: '2026-11-19T08:00:00Z',
  } as never,
}];

vi.mock('@/features/stock/hooks/usePendingExchangeItems', () => ({
  usePendingExchangeItems: () => pending,
}));

import { UsdtInbox } from '@/features/orders/components/UsdtInbox';

const state: TrackerState = {
  currency: 'QAR', range: 'all', batches: [], trades: [], customers: [], suppliers: [],
  cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [],
  usdtTransfers: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
};

describe('Orders USDT inbox', () => {
  it('shows a sent USDT movement with one sale path and one loan path', () => {
    const onSale = vi.fn();
    const onPurchase = vi.fn();
    const onLoan = vi.fn();
    render(<UsdtInbox state={state} onSale={onSale} onPurchase={onPurchase} onLoan={onLoan} />);

    expect(screen.getByText('ordersInboxTitle')).toBeTruthy();
    expect(screen.getByText(/10,000/)).toBeTruthy();
    expect(screen.getByText('ordersInboxSale')).toBeTruthy();
    expect(screen.getByText('ordersInboxLoan')).toBeTruthy();

    fireEvent.click(screen.getByText('ordersInboxSale'));
    expect(onSale).toHaveBeenCalledWith(expect.objectContaining({ key: 't:inbox-1' }));

    fireEvent.click(screen.getByText('ordersInboxLoan'));
    expect(onLoan).toHaveBeenCalledWith(expect.objectContaining({
      type: 'exchange_transfer',
      transfer: expect.objectContaining({ id: 'inbox-1' }),
    }));
  });
});
