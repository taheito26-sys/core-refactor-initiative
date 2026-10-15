import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<object>('react-router-dom')), useNavigate: () => navigate, useOutletContext: () => ({ openMenu: vi.fn() }) }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1', customerProfile: { display_name: 'محمد الدمراوي' } }) }));
const update = vi.fn();
let language: 'ar' | 'en' = 'ar';
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language }, update }) }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ unreadCount: 1 }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      channel: () => channel, removeChannel: vi.fn(),
      functions: { invoke: vi.fn(async () => ({ data: { statements: [{
        customerName: 'x', currency: 'QAR', totalLoaned: 1725472, totalRepaid: 1549045, outstanding: 176427, issueDate: '',
        orders: [], payments: [{ date: new Date(2026, 9, 13, 12).getTime(), amount: 30373 }, { date: new Date(2026, 9, 1).getTime(), amount: 30373 }],
      }] }, error: null })) },
    },
  };
});
vi.mock('@/features/customer/customer-portal', async () => ({
  ...(await vi.importActual<object>('@/features/customer/customer-portal')),
  listCustomerConnections: async () => ({ data: [] }),
  resolveCustomerDisplayName: (p: { display_name?: string }) => p?.display_name ?? null,
}));
vi.mock('@/features/customer/customer-market', () => ({
  getCustomerMarketKpis: async () => ({ guide: { rate: 54 }, egypt: { buyAvg: 54.455, emergencyAvg: 53.9675 } }),
}));
vi.mock('@/features/orders/shared-order-workflow', () => ({
  listSharedOrdersForActor: async () => [],
  getCashAccountsForUser: async () => [{ id: 'a' }],
}));
vi.mock('./CustomerOrdersPage', () => ({ NewOrderForm: () => null }));
vi.mock('@/pages/customer/CustomerOrdersPage', () => ({ NewOrderForm: () => null }));

import CustomerHomePage from '@/pages/customer/CustomerHomePage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CustomerHomePage /></MemoryRouter>
  </QueryClientProvider>,
);

describe('customer home page', () => {
  it('shows the live rates, the settlement summary and the latest payments', async () => {
    language = 'ar';
    renderPage();
    expect(screen.getByText('محمد الدمراوي')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('54.4550')).toBeTruthy());
    expect(screen.getByText('53.9675')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1,725,472')).toBeTruthy());
    expect(screen.getByText('1,549,045')).toBeTruthy();
    expect(screen.getByText('176,427')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getAllByText('دفع مستحقات').length).toBeGreaterThan(0);
    // Direction arrows read right to left in Arabic.
    expect(document.body.textContent).toContain('ريال ← جنيه');
  });

  it('switches language from the header pill and routes the quick actions', async () => {
    language = 'ar';
    renderPage();
    screen.getByText('EN').click();
    expect(update).toHaveBeenCalledWith({ language: 'en' });
    screen.getByText('الطلبات').click();
    expect(navigate).toHaveBeenCalledWith('/c/orders');
    screen.getByText('المحفظة').click();
    expect(navigate).toHaveBeenCalledWith('/c/wallet');
  });

  it('renders in English', async () => {
    language = 'en';
    renderPage();
    expect(screen.getByText('Emergency Price')).toBeTruthy();
    expect(screen.getByText('Latest Activity')).toBeTruthy();
    expect(document.body.textContent).toContain('QAR → EGP');
  });
});
