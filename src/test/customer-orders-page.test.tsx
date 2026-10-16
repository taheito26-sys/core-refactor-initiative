import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const update = vi.fn();
let language: 'ar' | 'en' = 'ar';
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<object>('react-router-dom')), useOutletContext: () => ({ openMenu: vi.fn() }) }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1', customerProfile: { display_name: 'x' } }) }));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language }, update }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ unreadCount: 2 }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/parent-order-fulfillment/components/MobileInstallBanner', () => ({ MobileInstallBanner: () => null }));
vi.mock('@/features/parent-order-fulfillment/components/ParentOrderCard', () => ({ ParentOrderCard: () => null }));
vi.mock('@/features/stock/utils/useMonthlyStatementExport', () => ({ useMonthlyStatementExport: () => ({ exportingFormat: null, exportStatement: vi.fn() }) }));

const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
vi.mock('@/integrations/supabase/client', () => {
  const chain: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res({ data: [], error: null }) : () => chain), apply: () => chain });
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => chain, rpc: async () => ({ data: null, error: null }), channel: () => channel, removeChannel: vi.fn(),
      functions: { invoke: vi.fn(async () => ({ data: { statements: [{
        customerName: 'x', currency: 'QAR', totalLoaned: 1733974, totalRepaid: 1599045, outstanding: 134929, issueDate: '',
        orders: [
          { ref: 'a', date: day(15), amount: 8484, settled: false, paid: 0, emergency: false },
          { ref: 'b', date: day(12), amount: 6234, settled: true, paid: 6234, emergency: true },
        ],
        payments: [],
      }] }, error: null })) },
    },
  };
});
vi.mock('@/features/orders/shared-order-workflow', async () => ({
  ...(await vi.importActual<object>('@/features/orders/shared-order-workflow')),
  listSharedOrdersForActor: async () => [{
    id: 'o1', customer_user_id: 'u1', merchant_id: 'm', connection_id: 'c', order_type: 't', amount: 8500, currency: 'QAR', status: 's', note: null,
    workflow_status: 'pending_customer_approval', placed_by_role: 'merchant', placed_by_user_id: 'm', approval_required_from_role: 'customer',
    approved_by_user_id: null, approved_at: null, rejected_by_user_id: null, rejected_at: null, rejection_reason: null, revision_no: 1,
    edited_from_order_id: null, fx_rate: 14.2, fulfillment_mode: null, usdt_qar_rate: null, required_usdt: null, send_country: 'QA',
    receive_country: 'EG', send_currency: 'QAR', receive_currency: 'EGP', payout_rail: null, corridor_label: null,
    created_at: new Date(2026, 9, 15, 18).toISOString(), updated_at: '',
  }],
  getCashAccountsForUser: async () => [],
}));

import CustomerOrdersPage from '@/pages/customer/CustomerOrdersPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CustomerOrdersPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe('customer orders page on a phone', () => {
  it('shows the new header, the compact summary and slim cards', async () => {
    language = 'ar';
    const { container } = renderPage();
    expect(container.querySelector('.ch-root.co-root')).toBeTruthy();
    expect(screen.getByText('طلباتي')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1,733,974')).toBeTruthy());
    expect(screen.getByText('1,599,045')).toBeTruthy();
    expect(screen.getByText('134,929')).toBeTruthy();
    expect(container.querySelectorAll('.co-card.co-hist').length).toBe(2);
    expect(container.querySelector('.co-card.emerg')).toBeTruthy();
    expect(container.querySelector('.co-card.warn.co-hist')).toBeTruthy();
    expect(screen.getByText('غير مسدد')).toBeTruthy();
  });

  it('keeps the approve and reject actions on a live order waiting for the customer', async () => {
    language = 'ar';
    renderPage();
    await waitFor(() => expect(screen.getByText('موافقة')).toBeTruthy());
    expect(screen.getByText('رفض')).toBeTruthy();
    expect(screen.getByText('بانتظار موافقة العميل')).toBeTruthy();
  });

  it('switches language from the header', async () => {
    language = 'ar';
    renderPage();
    screen.getByText('EN').click();
    expect(update).toHaveBeenCalledWith({ language: 'en' });
  });
});
