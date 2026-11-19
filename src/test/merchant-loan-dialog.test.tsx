import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const propose = { mutateAsync: vi.fn() };
const cancel = { mutateAsync: vi.fn() };
vi.mock('@/features/stock/hooks/useSharedLoanMoves', () => ({ useSharedLoanMoveActions: () => ({ propose, cancel, respond: {} }) }));
vi.mock('@/features/stock/hooks/useLoanMerchantNames', () => ({
  useLoanMerchantNames: () => [
    { name: 'Abu Tamim', connected: true, relationshipId: 'rel-1' },
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

describe('MerchantLoanDialog with a connected merchant', () => {
  const open = (commit: (s: TrackerState) => Promise<void>) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MerchantLoanDialog
          open
          presetName="Abu Tamim"
          sources={[{ type: 'manual', direction: 'out', ts: Date.now() - 60_000 }]}
          state={state}
          applyStateAndCommit={commit}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('mloanAmount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByText('loansSaveMovement'));
  };

  it('sends the movement to the other merchant first, then saves it with the shared id', async () => {
    propose.mutateAsync.mockResolvedValueOnce('move-1');
    const commit = vi.fn().mockResolvedValue(undefined);
    open(commit);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(propose.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'rel-1', direction: 'out', amount: 10000 }));
    const saved = commit.mock.calls[0][0] as TrackerState;
    expect(saved.usdtTransfers).toEqual([expect.objectContaining({ kind: 'lend_out', amountUSDT: 10000, remoteLoanId: 'move-1' })]);
  });

  it('saves nothing when the other merchant could not be reached', async () => {
    propose.mutateAsync.mockRejectedValueOnce(new Error('network'));
    const commit = vi.fn().mockResolvedValue(undefined);
    open(commit);
    await waitFor(() => expect(propose.mutateAsync).toHaveBeenCalled());
    expect(commit).not.toHaveBeenCalled();
  });
});
