import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('@/features/exchanges/hooks/useExchangeTransfers', () => ({
  useExchangeTransfers: () => ({
    data: [{
      id: 'net1', exchange: 'binance', kind: 'network', direction: 'out', asset: 'USDT', amount: 10999.9, status: 'ok',
      reference: '0x1603f4d8', counterparty: null, network: 'TRX', transfer_time: '2026-09-21T20:46:00Z',
      linked_entity_type: null, linked_entity_id: null, linked_at: null, dismissed_at: null, created_at: '',
    }],
  }),
}));
vi.mock('@/features/exchanges/hooks/useExchangeP2POrders', () => ({
  useExchangeP2POrders: () => ({
    data: [{
      id: 'o1', exchange: 'okx', order_number: '777', side: 'sell', asset: 'USDT', fiat: 'QAR', amount: 95000, price: 3.7,
      total: 351500, status: 'completed', counterparty: 'Abu Tamim', order_time: '2026-09-20T10:00:00Z',
      linked_entity_type: null, linked_entity_id: null, linked_at: null, created_at: '',
    }],
  }),
}));
vi.mock('@/features/exchanges/hooks/useExchangeOrderLinks', () => ({
  useExchangeOrderLinks: () => ({ data: new Map() }),
  sumLinkedAmount: (links: { allocated_amount: number }[] = []) => links.reduce((s, l) => s + l.allocated_amount, 0),
}));
vi.mock('@/features/exchanges/api', () => ({ dismissTransfer: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExchangeInbox } from '@/features/exchanges/components/ExchangeInbox';

function renderInbox(onLoanClick?: (src: unknown) => void) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExchangeInbox side="sell" onPick={vi.fn()} onPickTransfer={vi.fn()} activeEntityIds={new Set()} onLoanClick={onLoanClick} />
    </QueryClientProvider>,
  );
}

describe('ExchangeInbox merchant-loan button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the page the Network send as a loan source', () => {
    const onLoanClick = vi.fn();
    renderInbox(onLoanClick);
    // Rows newest first: the Sep 21 transfer, then the Sep 20 P2P order.
    fireEvent.click(screen.getAllByTitle('mloanInboxButton')[0]);
    expect(onLoanClick).toHaveBeenCalledWith({ type: 'exchange_transfer', transfer: expect.objectContaining({ id: 'net1' }) });
  });

  it('hands the page a P2P order with the amount still unregistered', () => {
    const onLoanClick = vi.fn();
    renderInbox(onLoanClick);
    fireEvent.click(screen.getAllByTitle('mloanInboxButton')[1]);
    expect(onLoanClick).toHaveBeenCalledWith({ type: 'exchange_order', order: expect.objectContaining({ id: 'o1' }), available: 95000 });
  });

  it('shows no loan button when the page does not support it', () => {
    renderInbox();
    expect(screen.queryAllByTitle('mloanInboxButton')).toHaveLength(0);
  });
});
