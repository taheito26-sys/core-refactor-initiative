// Regression: the Loans page crashed when a merchant-loan dialog opened, because the dialog and the requests bar
// each subscribed to the same realtime channel name and the client throws on a second listener.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { computeFIFO, type TrackerState } from '@/lib/tracker-helpers';

vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((k: string) => k, { lang: 'en', isRTL: false }) }));
const TABLES: Record<string, unknown> = {
  merchant_profiles: [{ merchant_id: 'M1', user_id: 'u1', display_name: 'ME' }, { merchant_id: 'M2', display_name: 'zack' }, { merchant_id: 'M3', display_name: 'Farida Abdelazim' }],
  merchant_relationships: [
    { id: 'r1', merchant_a_id: 'M1', merchant_b_id: 'M2', status: 'active' },
    { id: 'r2', merchant_a_id: 'M1', merchant_b_id: 'M2', status: 'active' },
    { id: 'r3', merchant_a_id: 'M3', merchant_b_id: 'M1', status: 'active' },
  ],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => {
  const rows = (TABLES[name] as unknown[]) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy({}, { get: (_t, p) => (p === 'then' ? (res: any) => res({ data: rows, error: null }) : p === 'maybeSingle' ? async () => ({ data: rows[0] ?? null }) : () => q) });
  return q;
};
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: (n: string) => table(n), rpc: async () => ({ data: null, error: null }),
  // Like the real client: asking for a name already in use returns the same, already-subscribed channel,
  // and adding a listener after subscribe() throws.
  channel: (name: string) => {
    const reg = ((globalThis as any).__ch ||= new Map());
    if (reg.has(name)) return reg.get(name);
    const c: any = { subscribed: false, on: () => { if (c.subscribed) throw new Error('cannot add `postgres_changes` callbacks for realtime:' + name + ' after `subscribe()`.'); return c; }, subscribe: () => { c.subscribed = true; return c; } };
    reg.set(name, c); return c;
  },
  removeChannel: () => {},
} }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const transfers = [{ id: 'in1', exchange: 'binance', kind: 'pay', direction: 'in', asset: 'USDT', amount: 5000, status: 'ok', reference: 'R1', counterparty: 'Someone', network: null, transfer_time: new Date(2026, 10, 1).toISOString(), linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '' }];
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({ useExchangeTransfers: () => ({ data: transfers }) }));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({ useExchangeP2POrders: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({ useExchangeOrderLinks: () => ({ data: new Map() }), sumLinkedAmount: () => 0 }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { LoansPanel } from '@/features/stock/components/LoansPanel';

const st = {
  currency: 'QAR', range: 'all', batches: [{ id: 'b', ts: 1, source: 'S', note: '', buyPriceQAR: 3.7, initialUSDT: 50000, revisions: [] }],
  trades: [], customers: [], suppliers: [], cashQAR: 0, cashOwner: '', cashHistory: [], cashAccounts: [], cashLedger: [], customerLoans: [],
  usdtTransfers: [{ id: 'x', ts: 2, kind: 'lend_out', amountUSDT: 100, counterpartyName: 'zack', hiddenFromLoans: true, createdAt: 2, source: { type: 'exchange', exchange: 'binance', transferIds: ['t'] } }],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 }, cal: { year: 2026, month: 10, selectedDay: null },
} as unknown as TrackerState;

describe('Loans page with live loan requests', () => {
  it('opens the merchant loan dialog while the requests bar is subscribed to the same realtime feed', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter>
        <LoansPanel state={st} derived={computeFIFO(st.batches, st.trades, st.usdtTransfers)} applyStateAndCommit={async () => {}} onImportPurchase={vi.fn()} />
      </MemoryRouter></QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /loansReview/ }));
    fireEvent.click(await screen.findByText(/mloanItsLoan/));
    // The requests bar and the dialog both use shared loan moves; opening the dialog must not throw.
    expect(await screen.findByText('loansSaveMovement')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /zack/ })).toBeTruthy();
  });
});
