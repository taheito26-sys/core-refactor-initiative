import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({
  useExchangeTransfers: () => ({
    data: [{
      id: 'e1', exchange: 'binance', kind: 'pay', direction: 'out', asset: 'USDT', amount: 5000, status: 'ok',
      reference: 'R1', counterparty: 'Omar', network: null, transfer_time: new Date(2026, 0, 3).toISOString(),
      linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '',
    }],
  }),
}));
const dismissTransfer = vi.fn(async (_id: string) => {});
vi.mock('@/features/exchanges/api', () => ({ dismissTransfer: (id: string) => dismissTransfer(id), undismissTransfer: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsdtTransfersPanel } from '@/features/stock/components/UsdtTransfersPanel';

function makeState(): TrackerState {
  const d = (day: number) => new Date(2026, 0, day).getTime();
  return {
    currency: 'QAR', range: 'all',
    batches: [{ id: 'b1', ts: d(1), source: 'Ali', note: '', buyPriceQAR: 3.695, initialUSDT: 20000, revisions: [] }],
    trades: [{ id: 'tr1', ts: d(2), inputMode: 'USDT', amountUSDT: 20000, sellPriceQAR: 3.695, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: 'c1' }],
    customers: [{ id: 'c1', name: 'Ali', phone: '', tier: '', dailyLimitUSDT: 0, notes: '', createdAt: 0 }],
    suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [], usdtTransfers: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 0, selectedDay: null },
  };
}

const rowText = (text: string) => (_: string, el: Element | null) => el?.tagName === 'DIV' && el.textContent === text;

function renderPanel(state: TrackerState, apply = vi.fn(async (_next: TrackerState) => {})) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <UsdtTransfersPanel state={state} derived={computeFIFO(state.batches, state.trades, state.usdtTransfers)} applyStateAndCommit={apply} />
    </QueryClientProvider>,
  );
  return apply;
}

describe('UsdtTransfersPanel', () => {
  it('lists received stock batches and tags one as borrowed', async () => {
    const apply = renderPanel(makeState());
    expect(screen.getByText(rowText('20,000 USDT · Ali'))).toBeTruthy();
    fireEvent.click(screen.getByText(/uxferTagBorrowed/));
    fireEvent.click(screen.getByText('uxferConfirm'));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const next = apply.mock.calls[0][0] as TrackerState;
    expect(next.usdtTransfers).toEqual([expect.objectContaining({ kind: 'borrow_in', counterpartyName: 'Ali', amountUSDT: 20000, source: { type: 'batch', id: 'b1' } })]);
  });

  it('tags only the amount typed, leaving the rest of the batch', async () => {
    const apply = renderPanel(makeState());
    fireEvent.click(screen.getByText(/uxferTagBorrowed/));
    fireEvent.change(screen.getByLabelText('uxferAmount'), { target: { value: '8000' } });
    fireEvent.click(screen.getByText('uxferConfirm'));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const next = apply.mock.calls[0][0] as TrackerState;
    expect(next.usdtTransfers![0]).toMatchObject({ amountUSDT: 8000, source: { type: 'batch', id: 'b1' } });
  });

  it('lists sent orders and exchange transfers, and tags a transfer as a repayment', async () => {
    const apply = renderPanel(makeState());
    fireEvent.click(screen.getByText(/uxferSent/));
    expect(screen.getByText(rowText('20,000 USDT · Ali'))).toBeTruthy();
    expect(screen.getByText(rowText('5,000 USDT · Omar'))).toBeTruthy();
    const repayButtons = screen.getAllByText(/uxferTagRepaid/);
    // Newest first: the Jan 3 exchange transfer, then the Jan 2 order.
    fireEvent.click(repayButtons[0]);
    fireEvent.click(screen.getByText('uxferConfirm'));
    await waitFor(() => expect(dismissTransfer).toHaveBeenCalledWith('e1'));
    const next = apply.mock.calls[0][0] as TrackerState;
    expect(next.usdtTransfers![0]).toMatchObject({ kind: 'borrow_repay', counterpartyName: 'Omar', amountUSDT: 5000 });
  });
});
