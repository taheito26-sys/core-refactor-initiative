import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const render = (ui: ReactElement, route = '/trading/net-position') => rtlRender(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);

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
const closeMonth = vi.fn(async () => {});
const snapshots = new Map<string, unknown>();
const saveOpening = vi.fn(async () => {});
vi.mock('@/features/net-position/api', () => ({
  useMonthlySnapshots: () => ({ snapshots, unavailable: false, loading: false }),
  useMonthClosing: () => ({ close: closeMonth, reopen: vi.fn(async () => {}) }),
  useOpeningOverrides: () => ({ overrides: new Map(), unavailable: false }),
  useOpeningOverrideSaving: () => ({ save: saveOpening, clear: vi.fn(async () => {}) }),
  usePersonalLoans: () => ({ loans: [], unavailable: false }),
  usePersonalLoanActions: () => ({ add: vi.fn(async () => 'x'), setRepayments: vi.fn(async () => {}), remove: vi.fn(async () => {}) }),
}));
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

  it('closes a finished month with its figures, and cannot close the month still running', async () => {
    render(<NetPositionPage />);
    expect((screen.getByText('npCloseMonth', { exact: false }).closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('previous month'));
    const button = screen.getByText('npCloseMonth', { exact: false }).closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(closeMonth).toHaveBeenCalledTimes(1);
    const [month, position, bridge] = closeMonth.mock.calls[0] as unknown as [string, { closing: unknown }, { closingQAR: number }];
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(position.closing).toBeTruthy();
    expect(typeof bridge.closingQAR).toBe('number');
  });

  it('opens the month named in the reminder link', () => {
    render(<NetPositionPage />, '/trading/net-position?month=2026-03');
    expect(screen.getByText('march 2026')).toBeTruthy();
  });

  it('saves a starting position typed by hand as the difference from the records', async () => {
    render(<NetPositionPage />);
    fireEvent.click(screen.getByText('npSetOpening', { exact: false }));
    fireEvent.change(screen.getByLabelText('npLineCashHand'), { target: { value: '9000' } });
    fireEvent.click(screen.getByText('npSaveOpening'));
    await Promise.resolve();
    expect(saveOpening).toHaveBeenCalledTimes(1);
    const [month, manual, offsets] = saveOpening.mock.calls[0] as unknown as [string, Record<string, number>, Record<string, number>];
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(manual.cash_hand).toBe(9000);
    expect(offsets.cash_hand).toBeTypeOf('number');
  });

  it('fills a line with what the tracker holds today when its Today figure is pressed', () => {
    render(<NetPositionPage />);
    fireEvent.click(screen.getByText('npSetOpening', { exact: false }));
    // The test ledger holds 5,000 in minus 200 out in the one hand account.
    fireEvent.click(screen.getAllByTitle('npUseToday')[0]);
    expect((screen.getByLabelText('npLineCashHand') as HTMLInputElement).value).toBe('4800');
    fireEvent.click(screen.getByText('npUseTodayAll'));
    expect((screen.getByLabelText('npLineCashHand') as HTMLInputElement).value).toBe('4800');
  });
});
