import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => {
  // Keys come back with their {placeholders} filled, so assertions can read real sentences.
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
}));
const transfers = [
  // Abu Tamim lent 33k by Pay, then four P2P sends paid it back.
  { id: 'in1', exchange: 'binance', kind: 'pay', direction: 'in', asset: 'USDT', amount: 33000, status: 'ok', reference: 'R1', counterparty: 'Abu Tamim', network: null, transfer_time: new Date(2026, 8, 1).toISOString(), linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '' },
];
const orders = [10000, 10000, 3000, 10000].map((amount, i) => ({
  id: `o${i}`, exchange: 'okx', order_number: `N${i}`, side: 'sell', asset: 'USDT', fiat: 'QAR', amount, price: 3.69, total: amount * 3.69,
  status: 'completed', counterparty: 'Abu Tamim', order_time: new Date(2026, 8, 2 + i).toISOString(),
  linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '',
}));
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({ useExchangeTransfers: () => ({ data: transfers }) }));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({ useExchangeP2POrders: () => ({ data: orders }) }));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({
  useExchangeOrderLinks: () => ({ data: new Map() }),
  sumLinkedAmount: (links: { allocated_amount: number }[] = []) => links.reduce((s, l) => s + l.allocated_amount, 0),
}));
const api = { dismissTransfer: vi.fn(async () => {}), undismissTransfer: vi.fn(async () => {}), addOrderLink: vi.fn(async () => {}), removeOrderLink: vi.fn(async () => {}) };
vi.mock('@/features/exchanges/api', () => ({
  dismissTransfer: (...a: unknown[]) => api.dismissTransfer(...(a as [])),
  undismissTransfer: (...a: unknown[]) => api.undismissTransfer(...(a as [])),
  addOrderLink: (...a: unknown[]) => api.addOrderLink(...(a as [])),
  removeOrderLink: (...a: unknown[]) => api.removeOrderLink(...(a as [])),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { LoansPanel } from '@/features/stock/components/LoansPanel';

function baseState(): TrackerState {
  return {
    currency: 'QAR', range: 'all',
    batches: [{ id: 'b', ts: new Date(2026, 7, 1).getTime(), source: 'Supplier', note: '', buyPriceQAR: 3.68, initialUSDT: 50000, revisions: [] }],
    trades: [], customers: [], suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [],
    customerLoans: [], usdtTransfers: [],
    settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 8, selectedDay: null },
  };
}

/** Renders the Loans tab with a real state loop: every commit re-renders with the new state, as the page does. */
function renderLoop(initial: TrackerState) {
  let current = initial;
  const commits: TrackerState[] = [];
  const qc = new QueryClient();
  const view = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoansPanel state={current} derived={computeFIFO(current.batches, current.trades, current.usdtTransfers)} applyStateAndCommit={apply} onImportPurchase={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  async function apply(next: TrackerState) {
    commits.push(next);
    current = next;
    utils.rerender(view());
  }
  const utils = render(view());
  return { commits, get state() { return current; } };
}

const pendingRow = (text: RegExp) => screen.getAllByText(text)[0].closest('[data-pending-key]') as HTMLElement;

describe('Loans tab, end to end as a user', () => {
  beforeEach(() => vi.clearAllMocks());

  it('borrow 33k by Pay, then tick the four P2P sends and repay: Abu Tamim ends settled', async () => {
    const app = renderLoop(baseState());
    expect(screen.getByText('mloanNeedsDecision')).toBeTruthy();

    // 1. The incoming 33k Pay transfer → Merchant loan → Abu Tamim.
    fireEvent.click(within(pendingRow(/33,000 USDT/)).getByText(/mloanItsLoan/));
    fireEvent.change(screen.getByPlaceholderText('mloanMerchantPlaceholder'), { target: { value: 'Abu Tamim' } });
    expect(screen.getByText(/mloanPreviewBorrow/)).toBeTruthy();
    fireEvent.click(screen.getByText('mloanConfirm'));
    await waitFor(() => expect(app.commits).toHaveLength(1));
    expect(app.state.usdtTransfers).toEqual([expect.objectContaining({ kind: 'borrow_in', amountUSDT: 33000, counterpartyName: 'Abu Tamim' })]);
    expect(api.dismissTransfer).toHaveBeenCalledWith('in1');

    // 2. Tick the four P2P sends and tag them together; the merchant is now offered with its balance.
    const boxes = screen.getAllByLabelText('mloanSelect');
    expect(boxes).toHaveLength(4);
    boxes.forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getAllByText(/mloanTitle/).find((el) => el.tagName === 'BUTTON')!);
    fireEvent.click(await screen.findByRole('button', { name: /Abu Tamim.*mloanYouOweShort 33,000/ }));
    expect(screen.getByText(/mloanPreviewRepay/)).toBeTruthy();
    fireEvent.click(screen.getByText('mloanConfirm'));
    await waitFor(() => expect(app.commits).toHaveLength(2));
    expect(app.state.usdtTransfers!.filter((x) => x.kind === 'borrow_repay')).toHaveLength(4);
    expect(api.addOrderLink).toHaveBeenCalledTimes(4);

    // 3. Settled: no open loans, one settled merchant with a 5-line statement.
    expect(screen.getByText('mloanNoOpen')).toBeTruthy();
    fireEvent.click(screen.getByText(/mloanSettledGroup/));
    fireEvent.click(screen.getByText('Abu Tamim'));
    expect(screen.getAllByText(/mloanKindRepaid/)).toHaveLength(4);
    expect(screen.getAllByText(/mloanKindBorrowed/)).toHaveLength(1);
  });

  it('undo on a statement line puts the record back in "Needs a decision"', async () => {
    const app = renderLoop(baseState());
    fireEvent.click(within(pendingRow(/33,000 USDT/)).getByText(/mloanItsLoan/));
    fireEvent.change(screen.getByPlaceholderText('mloanMerchantPlaceholder'), { target: { value: 'Abu Tamim' } });
    fireEvent.click(screen.getByText('mloanConfirm'));
    await waitFor(() => expect(app.commits).toHaveLength(1));

    fireEvent.click(screen.getByText('Abu Tamim'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('mloanUndo'));
    await waitFor(() => expect(app.commits).toHaveLength(2));
    expect(app.state.usdtTransfers!.every((x) => x.voided)).toBe(true);
    expect(api.undismissTransfer).toHaveBeenCalledWith('in1');
  });
});
