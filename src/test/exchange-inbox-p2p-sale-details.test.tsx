import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});

const base = {
  exchange: 'okx', kind: 'p2p', direction: 'out', asset: 'USDT', status: 'completed', counterparty: null, network: null,
  transfer_time: '2026-10-30T23:55:37Z', linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '',
};
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({
  useExchangeTransfers: () => ({
    data: [
      { ...base, id: 'p1', amount: 3000, reference: 'ref-set', sale_price_qar: 3.65, sale_customer_name: 'Abu Tamim' },
      { ...base, id: 'p2', amount: 500, reference: 'ref-unset', transfer_time: '2026-10-29T10:00:00Z' },
    ],
  }),
}));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({ useExchangeP2POrders: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({
  useExchangeOrderLinks: () => ({ data: new Map() }),
  sumLinkedAmount: () => 0,
}));
const setTransferSaleDetails = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/exchanges/api', () => ({ dismissTransfer: vi.fn(), setTransferSaleDetails: (...a: unknown[]) => setTransferSaleDetails(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExchangeInbox } from '@/features/exchanges/components/ExchangeInbox';

function renderInbox(onPickTransfer = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExchangeInbox side="sell" onPick={vi.fn()} onPickTransfer={onPickTransfer} activeEntityIds={new Set()} customerNames={['Abu Tamim']} />
    </QueryClientProvider>,
  );
  return onPickTransfer;
}

describe('OKX P2P price and customer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the saved price and customer, and a hint when none is set', () => {
    renderInbox();
    expect(screen.getByText('@ 3.65 QAR')).toBeTruthy();
    expect(screen.getByText('Abu Tamim')).toBeTruthy();
    expect(screen.getByText('no price or customer yet')).toBeTruthy();
  });

  it('prefills the sale form with the saved price and customer when picked', () => {
    const onPick = renderInbox();
    fireEvent.click(screen.getByText(/3,000 USDT/));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'p2p', buyPrice: 3.65, assigneeName: 'Abu Tamim' }));
  });

  it('saves a price and customer from the row editor', async () => {
    renderInbox();
    fireEvent.click(screen.getAllByTitle('Set price & customer')[1]);
    fireEvent.change(screen.getByLabelText('Sell price in QAR'), { target: { value: '3.7' } });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Zack' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(setTransferSaleDetails).toHaveBeenCalledWith('p2', { price: 3.7, customer: 'Zack' }));
  });
});
