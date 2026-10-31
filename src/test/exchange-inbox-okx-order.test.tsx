import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => ({ exchangeNeedsAmount: 'needs amount', exchangeSetAmount: 'Set amount received', exchangeFiatCurrency: 'Fiat currency', exchangeTotalReceived: 'Total received', exchangePricePerUsdt: 'Price per USDT', exchangeEnterRateInstead: 'Enter rate instead', save: 'Save' }[key] ?? key), { lang: 'en', isRTL: false });
  return { useT: () => t };
});

const okx = {
  exchange: 'okx', side: 'sell', asset: 'USDT', status: 'completed', counterparty: null,
  order_time: '2026-10-30T23:55:37Z', linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '',
  raw: { source: 'okx-escrow', bill: {} },
};
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({ useExchangeTransfers: () => ({ data: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({
  useExchangeP2POrders: () => ({
    data: [
      { ...okx, id: 'o1', order_number: 'B1', amount: 3000, fiat: 'QAR', price: 0, total: 0 },
      { ...okx, id: 'o2', order_number: 'B2', amount: 500, fiat: 'QAR', price: 3.65, total: 1825, counterparty: 'Abu Tamim', order_time: '2026-10-29T10:00:00Z' },
      { id: 'b1', exchange: 'binance', order_number: 'N1', side: 'sell', asset: 'USDT', fiat: 'QAR', amount: 100, price: 3.7, total: 370,
        status: 'completed', counterparty: 'X', order_time: '2026-10-28T10:00:00Z', linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '', raw: {} },
    ],
  }),
}));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({
  useExchangeOrderLinks: () => ({ data: new Map() }),
  sumLinkedAmount: () => 0,
}));
const setOrderSaleDetails = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/exchanges/api', () => ({
  dismissTransfer: vi.fn(),
  fetchFreshExchangeOrder: vi.fn().mockResolvedValue(null),
  setOrderSaleDetails: (...a: unknown[]) => setOrderSaleDetails(...a),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExchangeInbox } from '@/features/exchanges/components/ExchangeInbox';

function renderInbox(onPick = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExchangeInbox side="sell" onPick={onPick} activeEntityIds={new Set()} customerNames={['Abu Tamim']} />
    </QueryClientProvider>,
  );
  return onPick;
}

describe('OKX P2P orders in the inbox', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an OKX order like a Binance one, flagged when it still needs an amount', () => {
    renderInbox();
    expect(screen.getAllByText('OKX').length).toBe(2);
    expect(screen.getAllByText('P2P').length).toBe(3);
    expect(screen.getAllByText('needs amount').length).toBe(1);
    expect(screen.getByText('Abu Tamim')).toBeTruthy();
  });

  it('offers the amount pencil on OKX orders only', () => {
    renderInbox();
    expect(screen.getAllByTitle('Set amount received').length).toBe(2);
  });

  it('hands the sale form the saved price and customer when picked', async () => {
    const onPick = renderInbox();
    fireEvent.click(screen.getByText(/500/));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'B2', priceFiat: 3.65, assigneeName: 'Abu Tamim' }));
  });

  it('defaults an unpriced OKX order to EGP and derives the price from the total received', async () => {
    renderInbox();
    fireEvent.click(screen.getAllByTitle('Set amount received')[0]);
    expect((screen.getByLabelText('Fiat currency') as HTMLSelectElement).value).toBe('EGP');
    fireEvent.change(screen.getByLabelText('Total received'), { target: { value: '167100' } });
    expect(screen.getByText('55.7 EGP/USDT')).toBeTruthy();
    expect(screen.queryByLabelText('Customer')).toBeNull();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(setOrderSaleDetails).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', amount: 3000 }),
      { fiat: 'EGP', price: 55.7, customer: null, total: 167100 },
    ));
  });

  it('derives the total from a typed price', () => {
    renderInbox();
    fireEvent.click(screen.getAllByTitle('Set amount received')[0]);
    fireEvent.click(screen.getByText('Enter rate instead'));
    fireEvent.change(screen.getByLabelText('Price per USDT'), { target: { value: '55.7' } });
    expect(screen.getByText('167100 EGP')).toBeTruthy();
  });

  it('opens the entry form instead of importing an unpriced OKX order', () => {
    const onPick = renderInbox();
    fireEvent.click(screen.getByText(/3,000/));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Total received')).toBeTruthy();
  });

  it('keeps the fiat and existing counterparty when saving only the amount', async () => {
    renderInbox();
    fireEvent.click(screen.getAllByTitle('Set amount received')[1]);
    expect((screen.getByLabelText('Fiat currency') as HTMLSelectElement).value).toBe('QAR');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(setOrderSaleDetails).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o2' }),
      { fiat: 'QAR', price: 3.65, total: 1825, customer: 'Abu Tamim' },
    ));
  });
});
