import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { lowStockThreshold: 0, priceAlertThreshold: 0, range: 'all', currency: 'QAR' } }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const state = {
  cashAccounts: [
    { id: 'hand', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 },
    { id: 'old', name: 'Old cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 },
    { id: 'bank', name: 'Maserf Al Rayan', type: 'bank', currency: 'QAR', status: 'active', createdAt: 0 },
  ],
  cashLedger: [
    { id: 'a', ts: 1, type: 'deposit', accountId: 'hand', direction: 'in', amount: 125500, currency: 'QAR' },
    { id: 'b', ts: 1, type: 'deposit', accountId: 'bank', direction: 'in', amount: 49000, currency: 'QAR' },
    { id: 'c', ts: 1, type: 'deposit', accountId: 'old', direction: 'in', amount: 80000, currency: 'QAR' },
  ],
  customers: [{ id: 'dam', name: 'Muhammad Al-Damrawi' }],
  customerLoans: [{ id: 'l', ts: 1, customerId: 'dam', principal: 177295.72, currency: 'QAR', status: 'open', createdAt: 0, repayments: [] }],
  deletedLoanIds: [], batches: [], trades: [], usdtTransfers: [],
};
const applyState = vi.fn();
vi.mock('@/lib/useTrackerState', () => ({ useTrackerState: () => ({ state, applyState }) }));

let included: string[] = ['hand', 'bank'];
const saveSettings = vi.fn(async (next: { includedAccounts: string[] }) => { included = next.includedAccounts; });
const saveDay = vi.fn(async () => {});
vi.mock('@/features/net-position/api', () => ({
  useNetPositionSettings: () => ({ settings: { includedAccounts: included, usdRate: null, egpRate: null }, loaded: true, unavailable: false, save: saveSettings }),
  useNetPositionDays: () => ({ days: [], loaded: true, unavailable: false, save: saveDay }),
  usePersonalLoans: () => ({ loans: [], unavailable: false }),
  usePersonalLoanActions: () => ({ add: vi.fn(async () => 'x'), setRepayments: vi.fn(async () => {}), remove: vi.fn(async () => {}) }),
}));
vi.mock('@/features/exchanges/hooks/useExchangeBalances', () => ({
  useExchangeBalances: () => ({ data: [{ exchange: 'binance', asset: 'USDT', free: 0, locked: 0 }] }),
}));

import NetPositionPage from '@/pages/NetPositionPage';

describe('NetPositionPage', () => {
  it('shows the net position from the ticked accounts and the loans in the system', () => {
    render(<NetPositionPage />);
    // 125,500 cash + 49,000 bank + 177,295 owed by Muhammad Al-Damrawi. The unticked account is left out.
    const body = document.body.textContent || '';
    expect(body).toContain('351,795');
    expect(body).not.toContain('431,795');
  });

  it('has the five lines and nothing about typing opening figures', () => {
    render(<NetPositionPage />);
    for (const title of ['Cash in hand', 'Money in banks', 'USDT on exchanges', 'Customer loans', 'Personal loans']) {
      expect(screen.getAllByText(title, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/starting position/i)).toBeNull();
    expect(screen.queryByText(/Use today/i)).toBeNull();
    expect(screen.queryByLabelText(/opening/i)).toBeNull();
  });

  it('lets an account be ticked, and saves the choice', () => {
    render(<NetPositionPage />);
    fireEvent.click(screen.getByLabelText('Old cash'));
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.calls[0][0].includedAccounts.sort()).toEqual(['bank', 'hand', 'old']);
  });

  it('lists the customer owed in the loans line', () => {
    render(<NetPositionPage />);
    fireEvent.click(screen.getAllByText('Customer loans', { exact: false })[0]);
    expect(screen.getByText('Muhammad Al-Damrawi')).toBeTruthy();
  });
});
