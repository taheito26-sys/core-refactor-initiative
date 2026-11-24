import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { encodePayeeNote, type BankAccount, type BankLedgerRow } from './bank-book';

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1' }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({}) } }));
vi.mock('@/features/customer/statements-api', () => ({
  statementQueryOptions: () => ({
    queryKey: ['stmt-test'],
    queryFn: async () => [{
      customerName: 'x', currency: 'EGP', totalLoaned: 0, totalRepaid: 0, outstanding: 0, issueDate: '', payments: [],
      orders: [{ ref: 'ORD-7', date: Date.now() - 3600000, amount: 400000, paid: 0, remaining: 400000, settled: false, note: null }],
    }],
  }),
}));

import { CustomerBanksTab } from './CustomerBanksTab';

const misr: BankAccount = { id: 'misr', name: 'Bank Misr', type: 'bank', currency: 'EGP', status: 'active', created_at: Date.now() - 86400000 * 3 };
const now = Date.now();
const ledger: BankLedgerRow[] = [
  { id: 'open', account_id: 'misr', contra_account_id: null, ts: now - 86400000 * 3, type: 'opening', direction: 'in', amount: 1000000, currency: 'EGP', note: null, linked_entity_id: null, linked_entity_type: null },
  { id: 'p1', account_id: 'misr', contra_account_id: null, ts: now - 60000, type: 'withdrawal', direction: 'out', amount: 200000, currency: 'EGP', note: encodePayeeNote('Supplier 1', null), linked_entity_id: null, linked_entity_type: null },
  { id: 'p2', account_id: 'misr', contra_account_id: null, ts: now - 30000, type: 'withdrawal', direction: 'out', amount: 100000, currency: 'EGP', note: encodePayeeNote('Supplier 2', null), linked_entity_id: null, linked_entity_type: null },
];

function renderTab(accounts: BankAccount[], rows: BankLedgerRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CustomerBanksTab accounts={accounts} ledger={rows} lang="en" /></QueryClientProvider>);
}

describe('CustomerBanksTab', () => {
  it('offers to add a bank when there is none', () => {
    renderTab([], []);
    expect(screen.getByText('Track your bank accounts')).toBeTruthy();
  });

  it('shows the order deposit, the balance and where the money went', async () => {
    renderTab([misr], ledger);
    expect(await screen.findByText('Merchant order · ORD-7')).toBeTruthy();
    // 1,000,000 opening + 400,000 order − 300,000 sent
    expect(screen.getAllByText('1,100,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Supplier 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Where your money went')).toBeTruthy();
  });

  it('previews an import, counting completed transfers only', async () => {
    renderTab([misr], []);
    fireEvent.click(screen.getByText('Bank Misr'));
    fireEvent.click(screen.getByText('Import'));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const body = JSON.stringify({
      format: 'bank-transfers/1', bank: 'Banque Misr', currency: 'EGP',
      beneficiaries: [{ name: 'Supplier 1', bank: 'Banque Misr', account: '1' }],
      transfers: [
        { payee: 'Supplier 1', amount: 90590, at: '2026-11-01T15:41', status: 'completed' },
        { payee: 'School', amount: 102000, at: '2026-08-23T20:25', status: 'failed_refunded' },
      ],
    });
    const file = new File([body], 'bm.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Import bank transfers')).toBeTruthy();
    expect(screen.getByText('90,590 EGP')).toBeTruthy();
    expect(screen.getByText('Not imported — did not go through')).toBeTruthy();
  });
});
