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
  useLoanMerchantNames: () => [
    { name: 'Abu Tamim', connected: true },
    { name: 'OKX Pay', connected: false, net: 15000 },
  ],
}));

import { MerchantLoanDialog } from '@/features/stock/components/MerchantLoanDialog';

const state: TrackerState = {
  currency: 'QAR', range: 'all', batches: [], trades: [], customers: [], suppliers: [],
  cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [],
  usdtTransfers: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
};

describe('MerchantLoanDialog merchant picker', () => {
  it('groups connected merchants and displays the live sync state after choosing one', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MerchantLoanDialog
          open
          sources={[{ type: 'manual', direction: 'out', ts: Date.now() }]}
          state={state}
          applyStateAndCommit={async () => {}}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('loansConnectedGroup')).toBeTruthy();
    expect(screen.getByText('loansHistoryGroup')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Abu Tamim/ }));
    expect(screen.getByText('loansConnectedSync')).toBeTruthy();
  });
});
