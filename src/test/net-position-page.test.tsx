import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { lowStockThreshold: 0, priceAlertThreshold: 0, range: 'all', currency: 'QAR' } }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const now = Date.now();
const applyState = vi.fn();
const state = {
  cashAccounts: [{ id: 'hand', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }],
  cashLedger: [
    { id: 'a', ts: now - 3600_000, type: 'deposit', accountId: 'hand', direction: 'in', amount: 5000, currency: 'QAR' },
    { id: 'w', ts: now - 1800_000, type: 'withdrawal', accountId: 'hand', direction: 'out', amount: 200, currency: 'QAR', note: 'office' },
  ],
  batches: [], trades: [], customerLoans: [], deletedLoanIds: [], usdtTransfers: [],
};
vi.mock('@/lib/useTrackerState', () => ({ useTrackerState: () => ({ state, applyState }) }));

import NetPositionPage from '@/pages/NetPositionPage';

describe('NetPositionPage', () => {
  it('shows the month, the uncategorised withdrawal, and saves a category on the entry', () => {
    render(<NetPositionPage />);
    expect(screen.getByText('npNavTitle', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('npUncategorised', { exact: false }).length).toBeGreaterThan(0);
    const selects = screen.getAllByRole('combobox');
    // First select belongs to the uncategorised withdrawal row.
    fireEvent.change(selects[0], { target: { value: 'rent' } });
    expect(applyState).toHaveBeenCalled();
    const next = applyState.mock.calls[0][0];
    expect(next.cashLedger.find((e: { id: string }) => e.id === 'w').expenseCategory).toBe('rent');
  });
});
