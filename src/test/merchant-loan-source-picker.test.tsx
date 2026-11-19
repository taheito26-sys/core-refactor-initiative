import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/stock/hooks/useLoanMerchantNames', () => ({
  useLoanMerchantNames: () => [{ name: 'E2E Receiver', connected: true }],
}));
vi.mock('@/features/stock/hooks/usePendingExchangeItems', () => ({
  usePendingExchangeItems: () => [{
    key: 't:inbox-2',
    source: 'transfer',
    exchange: 'binance',
    direction: 'out',
    ts: Date.parse('2026-11-19T08:00:00Z'),
    pendingUSDT: 10000,
    effect: 10000,
    counterparty: 'E2E Receiver',
    reference: 'E2E-INBOX-2',
    transfer: {
      id: 'inbox-2',
      exchange: 'binance',
      direction: 'out',
      asset: 'USDT',
      amount: 10000,
      kind: 'pay',
      reference: 'E2E-INBOX-2',
      counterparty: 'E2E Receiver',
      transfer_time: '2026-11-19T08:00:00Z',
    },
  }],
}));

import { MerchantLoanDialog } from '@/features/stock/components/MerchantLoanDialog';

const state: TrackerState = {
  currency: 'QAR', range: 'all', batches: [], trades: [], customers: [], suppliers: [],
  cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [],
  usdtTransfers: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
};

describe('Merchant loan source picker', () => {
  it('links an unregistered sent USDT movement after the merchant is chosen', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MerchantLoanDialog
          open
          allowSourcePick
          sources={[{ type: 'manual', direction: 'out', ts: Date.now() }]}
          state={state}
          applyStateAndCommit={async () => {}}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('loansLinkSource')).toBeTruthy();
    expect(screen.getByText('loansLinkSourceChooseMerchant')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /E2E Receiver/ }));
    expect(screen.getByText('10,000 USDT')).toBeTruthy();

    fireEvent.click(screen.getByText('loansLinkSourceUse'));

    expect(screen.getByText('loansLinkedSource')).toBeTruthy();
    expect(screen.getByText('loansChangeSource')).toBeTruthy();
    expect(screen.getByDisplayValue('10000')).toBeTruthy();
  });
});
