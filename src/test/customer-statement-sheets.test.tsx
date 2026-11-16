import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CashStatementSheet, LoanStatementSheet } from '@/features/customer/components/StatementSheets';
import { buildHistoryLines, eventsFromLedger } from '@/features/stock/utils/accountHistory';
import type { PublicStatement } from '@/features/stock/components/PublicStatementReport';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const at = (m: number, d: number) => new Date(2026, m, d, 12).getTime();
const NOW = Date.now();
const statement = (over: Partial<PublicStatement> = {}): PublicStatement => ({
  customerName: 'Mohamed', currency: 'QAR', totalLoaned: 100000, totalRepaid: 65000, outstanding: 35000, issueDate: '2026-11-15',
  orders: [{ ref: 'ORD-1', date: NOW - 5 * 86400000, amount: 100000, paid: 65000, remaining: 35000, settled: false, note: null }],
  payments: [{ date: NOW - 2 * 86400000, amount: 50000, note: null, ref: null }, { date: NOW - 86400000, amount: 15000, note: null, ref: null }],
  ...over,
});

describe('LoanStatementSheet', () => {
  it('lists the orders as out and the payments as in, with the balance after each', () => {
    render(<LoanStatementSheet open onOpenChange={() => {}} lang="en" statements={[statement()]} />);
    const dialog = screen.getByRole('dialog');
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Out')).toBeTruthy();
    expect(within(rows[1]).getByText('In')).toBeTruthy();
    expect(within(rows[2]).getByText('Unpaid after 35,000')).toBeTruthy();
  });

  it('gives each currency its own statement', () => {
    render(<LoanStatementSheet open onOpenChange={() => {}} lang="en" statements={[statement(), statement({ currency: 'EGP' })]} />);
    expect(within(screen.getByRole('dialog')).getAllByRole('region')).toHaveLength(2);
  });

  it('renders nothing while closed', () => {
    render(<LoanStatementSheet open={false} onOpenChange={() => {}} lang="en" statements={[statement()]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CashStatementSheet', () => {
  const ledger = [
    { id: 'a', ts: NOW - 6 * 86400000, direction: 'in' as const, amount: 10000, type: 'deposit', note: 'Salary' },
    { id: 'b', ts: NOW - 3 * 86400000, direction: 'out' as const, amount: 2500, type: 'withdrawal', note: null },
  ];

  it('shows money in as In and money out as Out with the balance after', () => {
    render(<CashStatementSheet open onOpenChange={() => {}} lang="en" accountName="Savings" currency="EGP" ledger={ledger} typeLabel={t => ({ deposit: 'Deposit', withdrawal: 'Withdrawal' } as Record<string, string>)[t] ?? t} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Savings')).toBeTruthy();
    const [dep, wd] = within(dialog).getAllByRole('listitem');
    expect(within(dep).getByText('Deposit')).toBeTruthy();
    expect(within(dep).getByText('In')).toBeTruthy();
    expect(within(wd).getByText('Out')).toBeTruthy();
    expect(within(wd).getByText('Balance after 7,500')).toBeTruthy();
  });

  it('reads in Arabic', () => {
    render(<CashStatementSheet open onOpenChange={() => {}} lang="ar" accountName="التوفير" currency="EGP" ledger={ledger} />);
    expect(within(screen.getByRole('dialog')).getByText('وارد')).toBeTruthy();
  });
});

describe('eventsFromLedger', () => {
  it('turns money in and out into a running balance', () => {
    const lines = buildHistoryLines(eventsFromLedger([
      { id: '1', ts: at(10, 1), direction: 'in', amount: '5000.000000', type: 'opening', note: null },
      { id: '2', ts: at(10, 2), direction: 'out', amount: 1200, type: 'withdrawal', note: null },
    ]));
    expect(lines.map(l => [l.before, l.after])).toEqual([[0, 5000], [5000, 3800]]);
  });
});
