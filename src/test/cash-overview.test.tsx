import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildStateFrom } from '@/lib/tracker-state';
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' } }) }));
vi.mock('@/features/net-position/api', () => ({ useNetPositionSettings: () => ({ loaded: true, settings: { includedAccounts: ['cash', 'bank'] } }), usePersonalLoans: () => ({ loaded: true, loans: [] }) }));
vi.mock('@/features/exchanges/hooks/useExchangeBalances', () => ({ useExchangeBalances: () => ({ isSuccess: true, data: [] }) }));
vi.mock('@/features/stock/utils/loanStatementExport', async () => ({ ...await vi.importActual<object>('@/features/stock/utils/loanStatementExport'), downloadTextFile: vi.fn() }));
import { CashOverview } from '@/features/cash/CashOverview';
import { downloadTextFile } from '@/features/stock/utils/loanStatementExport';
const ts = new Date(2026, 8, 25, 12).getTime();
const { state } = buildStateFrom({ cashAccounts: [{ id: 'cash', name: 'Cash', type: 'hand', currency: 'QAR', status: 'active', createdAt: ts }, { id: 'bank', name: 'My Bank', type: 'bank', currency: 'QAR', status: 'active', createdAt: ts }], cashLedger: [{ id: 'one', accountId: 'cash', ts, amount: 80000, currency: 'QAR', type: 'deposit', direction: 'in' }, { id: 'two', accountId: 'bank', ts, amount: 17864, currency: 'QAR', type: 'deposit', direction: 'in' }] });
const onSection = vi.fn(), onAccountAction = vi.fn(), onAddAccount = vi.fn(), onAddCash = vi.fn(), onTransfer = vi.fn(), onCustody = vi.fn();
const show = () => render(<MemoryRouter><CashOverview state={state} section="accounts" onSection={onSection} onAccountAction={onAccountAction} onAddAccount={onAddAccount} onAddCash={onAddCash} onTransfer={onTransfer} onCustody={onCustody} loaded now={new Date(2026, 9, 29, 12).getTime()} /></MemoryRouter>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('cash management reference layout', () => {
  it('shows real accounts, searches and switches cards/list view', () => {
    show(); expect(screen.getByRole('heading', { name: 'Cash Management' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bank' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'My Bank' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.cm-list-view')).toBeTruthy();
  });
  it('routes account ledger, cash and transfer actions to the original handlers', () => {
    show(); const card = screen.getByRole('article', { name: 'Cash' });
    fireEvent.click(within(card).getByRole('button', { name: 'View Ledger' }));
    expect(onAccountAction).toHaveBeenLastCalledWith(state.cashAccounts[0], 'ledger');
    fireEvent.click(within(card).getByRole('button', { name: 'Add Cash' }));
    expect(onAccountAction).toHaveBeenLastCalledWith(state.cashAccounts[0], 'deposit');
    fireEvent.click(within(card).getByRole('button', { name: 'Transfer' }));
    expect(onAccountAction).toHaveBeenLastCalledWith(state.cashAccounts[0], 'transfer');
  });
  it('filters account type and exports the selected account ledger only', () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Filter accounts' }));
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'bank' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('article', { name: 'My Bank' })).getByRole('button', { name: 'Statement' }));
    expect(downloadTextFile).toHaveBeenCalledWith(expect.stringContaining('account-bank'), expect.stringContaining('17864'));
    expect(vi.mocked(downloadTextFile).mock.calls[0][1]).not.toContain('80000');
  });
  it('opens the original loan and cash actions', () => {
    show(); fireEvent.click(within(screen.getByRole('navigation', { name: 'Cash Management' })).getByRole('button', { name: 'Loans' }));
    expect(onSection).toHaveBeenCalledWith('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Add Account' })); expect(onAddAccount).toHaveBeenCalledOnce();
  });
});
