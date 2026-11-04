import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState } from '@/lib/tracker-state';
import type { TrackerState } from '@/lib/tracker-helpers';
import { taggedExchangeTransferIds } from '@/lib/usdt-transfers';
import type { ExchangeBalance, ExchangeTransfer } from '@/features/exchanges/types';
import { findPendingExchangeItems } from '@/features/exchanges/reconcile';
import { currentUsdt, recordMerchantMovement } from '@/features/stock/usdt-workspace-model';
const { credentials, sync, saved, language } = vi.hoisted(() => ({ credentials: { value: [] as Array<{ exchange: 'binance'; last_sync_error: string | null }> }, sync: vi.fn(), saved: vi.fn(), language: { value: 'en' } }));
vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { lang: language.value, isRTL: language.value === 'ar' }) }));
vi.mock('@/features/exchanges/hooks/useExchangeCredentials', () => ({ useExchangeCredentials: () => ({ data: credentials.value, isPending: false, error: null }) }));
vi.mock('@/features/exchanges/api', () => ({ syncExchange: sync }));
vi.mock('@/features/stock/hooks/useLoanMerchantNames', () => ({ useLoanMerchantNames: () => [{ name: 'Omar', net: 0 }] }));
vi.mock('@/features/stock/hooks/useBorrowLendCommit', () => ({ useBorrowLendCommit: (apply: (state: TrackerState) => Promise<void>) => ({ busy: false, commit: async (result: { state: TrackerState }) => { await apply(result.state); return true; } }) }));
import { UsdtBalanceWorkspace } from '@/features/stock/components/UsdtBalanceWorkspace';
const baseline = (): TrackerState => ({ ...createEmptyState().state, batches: [{ id: 'stock', ts: Date.now() - 864e5, initialUSDT: 30000, buyPriceQAR: 3.7, source: 'Supplier', note: '', revisions: [] }] });
const wallet = (qty: number, age = 0): ExchangeBalance => ({ id: 'wallet', exchange: 'binance', asset: 'USDT', account_type: 'funding', free: qty, locked: 0, updated_at: new Date(Date.now() - age).toISOString() });
const feed = (qty: number, direction: 'in' | 'out' = 'out'): ExchangeTransfer => ({ id: 'feed', exchange: 'binance', kind: 'pay', direction, asset: 'USDT', amount: qty, status: 'completed', reference: 'EXCHANGE-REF', counterparty: 'Omar', network: null, transfer_time: new Date().toISOString(), created_at: new Date().toISOString(), linked_at: null, linked_entity_id: null, linked_entity_type: null, dismissed_at: null });
function Harness({ initial, balance, transfer }: { initial?: TrackerState; balance?: ExchangeBalance; transfer?: ExchangeTransfer }) {
  const [state, setState] = useState(initial ?? baseline());
  const pending = findPendingExchangeItems({ orders: [], linksByOrder: new Map(), transfers: transfer ? [transfer] : [], importedReferences: new Set(), liveEntityIds: new Set(), taggedTransferIds: taggedExchangeTransferIds(state.usdtTransfers) });
  return <UsdtBalanceWorkspace state={state} available={currentUsdt(state)} balances={balance ? [balance] : undefined} pending={pending} applyStateAndCommit={async next => { saved(next); setState(next); }} onReviewAll={() => {}} onRecordTrade={() => {}} />;
}
const mount = (props: Parameters<typeof Harness>[0] = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness {...props} /></QueryClientProvider>);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); language.value = 'en'; credentials.value = [{ exchange: 'binance', last_sync_error: null }]; sync.mockResolvedValue({ summary: { balances: 1 } }); });
afterEach(cleanup);

describe('USDT workspace user flow', () => {
  it('records a merchant advance from the exchange reference with no sale or buyer form', async () => {
    mount({ balance: wallet(20000), transfer: feed(10000) });
    expect(screen.getByText('Difference to review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sent USDT · Sulfa' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't:feed' } });
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Omar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record USDT transfer' }));
    await screen.findByText('Balances match');
    expect(saved).toHaveBeenCalledTimes(1);
    const next = saved.mock.calls[0][0] as TrackerState;
    expect(next.trades).toHaveLength(0); expect(next.customerLoans).toHaveLength(0);
    expect(next.usdtTransfers?.[0]).toMatchObject({ amountUSDT: 10000, kind: 'lend_out', counterpartyName: 'Omar' });
    expect(currentUsdt(next)).toBe(20000);
    expect(screen.getByRole('button', { name: 'Record a return' })).toBeTruthy();
    expect(screen.queryByText('Fix with batches')).toBeNull();
  });
  it('prefills a receipt from the merchant and supports a partial return', async () => {
    const initial = recordMerchantMovement(baseline(), { name: 'Omar', direction: 'out', amount: 10000, ts: Date.now() - 60000 }, () => 'existing').state;
    mount({ initial, balance: wallet(23000), transfer: feed(3000, 'in') });
    fireEvent.click(screen.getByRole('button', { name: 'Record a return' }));
    expect(screen.getByRole('button', { name: 'I received USDT' }).className).toContain('selected');
    expect((screen.getByLabelText('Merchant') as HTMLInputElement).value).toBe('Omar');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't:feed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record USDT transfer' }));
    await screen.findByText('Balances match');
    const next = saved.mock.calls[0][0] as TrackerState;
    expect(next.usdtTransfers?.at(-1)).toMatchObject({ amountUSDT: 3000, kind: 'lend_return' });
    expect(currentUsdt(next)).toBe(23000);
    expect(screen.getByText('7,000')).toBeTruthy();
  });
  it('links a manual entry to its exchange record without recording a second transfer', async () => {
    const initial = recordMerchantMovement(baseline(), { name: 'Omar', direction: 'out', amount: 10000, ts: Date.now() - 60000 }, () => 'existing').state;
    mount({ initial, balance: wallet(20000), transfer: feed(10000) });
    fireEvent.click(screen.getByRole('button', { name: /Review movements/ }));
    fireEvent.click(screen.getByRole('button', { name: /Link without recording again/ }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const next = saved.mock.calls[0][0] as TrackerState;
    expect(next.usdtTransfers).toHaveLength(1); expect(currentUsdt(next)).toBe(20000);
    expect(taggedExchangeTransferIds(next.usdtTransfers).has('feed')).toBe(true);
  });
  it('does not claim a verified match from stale balances and refreshes only connected exchanges', async () => {
    mount({ balance: wallet(30000, 3600e3) });
    expect(screen.getByText('Sync to verify')).toBeTruthy();
    expect(screen.queryByText('Balances match')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sync balances' }));
    await screen.findByText('Balances match');
    expect(sync).toHaveBeenCalledWith('binance', 'balances');
  });
  it('shows a sync failure instead of claiming the old snapshot is current', async () => {
    sync.mockResolvedValue({ errors: { balances: 'Exchange unavailable' } });
    mount({ balance: wallet(30000, 3600e3) });
    fireEvent.click(screen.getByRole('button', { name: 'Sync balances' }));
    await screen.findByText('BINANCE: Exchange unavailable');
    expect(screen.queryByText('Balances match')).toBeNull();
  });
  it('works without an exchange connection and supports Arabic RTL', async () => {
    credentials.value = []; language.value = 'ar';
    const view = mount();
    await act(async () => {});
    expect(view.container.querySelector('.usdt-workspace')?.getAttribute('dir')).toBe('rtl');
    expect(screen.getByText('اربط منصة للمقارنة')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'أرسلت USDT · سلفة' })).toBeTruthy();
  });
});
