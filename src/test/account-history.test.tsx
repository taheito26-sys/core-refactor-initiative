import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccountHistory } from '@/features/stock/components/AccountHistory';
import type { HistoryEvent } from '@/features/stock/utils/accountHistory';
import { downloadTextFile } from '@/features/stock/utils/loanStatementExport';

vi.mock('@/features/stock/utils/loanStatementExport', async () => ({ ...await vi.importActual<object>('@/features/stock/utils/loanStatementExport'), downloadTextFile: vi.fn() }));

const NOW = new Date(2026, 10, 15, 12).getTime();
const at = (m: number, d: number) => new Date(2026, m, d, 12).getTime();
const events: HistoryEvent[] = [
  { id: 'o0', ts: at(8, 1), kind: 'charge', amount: 20000, ref: 'ORD-1', description: '' },
  { id: 'o1', ts: at(10, 10), kind: 'charge', amount: 66000, ref: 'ORD-2', description: '' },
  { id: 'p1', ts: at(10, 14), kind: 'payment', amount: 15000, ref: 'ORD-2', description: 'Customer-reported', groupId: 'b1' },
  { id: 'p2', ts: at(10, 14), kind: 'payment', amount: 50000, ref: 'ORD-2', description: 'Customer-reported', groupId: 'b2' },
];
const show = (lang: 'en' | 'ar' = 'en', extra: object = {}) => render(<AccountHistory events={events} currency="QAR" lang={lang} now={NOW} {...extra} />);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AccountHistory', () => {
  it('shows each payment with the unpaid amount before and after it', () => {
    show();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const fifty = rows[2];
    expect(within(fifty).getByText('Unpaid before 71,000')).toBeTruthy();
    expect(within(fifty).getByText('−50,000')).toBeTruthy();
    expect(within(fifty).getByText('Unpaid after 21,000')).toBeTruthy();
  });

  it('opens the period with the balance it started from and closes with where it ended', () => {
    show();
    expect(screen.getByText('Opening balance').parentElement?.textContent).toContain('20,000 QAR');
    expect(screen.getByText('Closing balance').parentElement?.textContent).toContain('21,000 QAR');
  });

  it('goes back in time to any period and any day', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(screen.getByText('No activity in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Unpaid on'), { target: { value: '2026-11-12' } });
    expect(screen.getByLabelText('Unpaid on').closest('div')?.parentElement?.textContent).toContain('86,000');
  });

  it('names an accepted payment that is not in the balance', () => {
    show('en', { unapplied: [{ id: 'c', customerId: 'x', currency: 'QAR', amount: 17500, status: 'accepted', source: 'customer_claim', appliedBatchId: 'lost', note: null, paidAt: new Date(2026, 9, 19).toISOString() }] });
    expect(screen.getByRole('alert').textContent).toContain('17,500 QAR');
  });

  it('exports the shown period as a statement with opening and closing rows', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const csv = vi.mocked(downloadTextFile).mock.calls[0][1] as string;
    expect(csv).toContain('Opening balance');
    expect(csv).toContain('Closing balance');
    expect(csv).toContain('"Out (QAR)","In (QAR)","Balance (QAR)"');
    expect(csv).toMatch(/"Payment",.*,"","50000","21000"/);
  });

  it('reads in Arabic, right to left', () => {
    show('ar');
    expect(screen.getByRole('region', { name: 'كشف حساب تفصيلي' }).getAttribute('dir')).toBe('rtl');
    expect(screen.getByText('الرصيد الافتتاحي')).toBeTruthy();
  });

  it('explains a difference to the unpaid total the account reports', () => {
    show('en', { expectedBalance: 21002.01 });
    expect(screen.getByText(/overpayment on an order that is already closed/)).toBeTruthy();
  });
});

describe('AccountHistory as a statement of money held', () => {
  const rows: HistoryEvent[] = [
    { id: 'a', ts: at(10, 1), kind: 'charge', amount: 5000, ref: 'Deposit', description: 'Salary' },
    { id: 'b', ts: at(10, 5), kind: 'payment', amount: 1200, ref: 'Withdrawal', description: '' },
  ];

  it('speaks of money in and out and the balance', () => {
    render(<AccountHistory events={rows} currency="EGP" lang="en" now={NOW} mode="cash" />);
    expect(screen.getByRole('region', { name: 'Account statement' })).toBeTruthy();
    const [dep, wd] = screen.getAllByRole('listitem');
    expect(within(dep).getByText('Deposit')).toBeTruthy();
    expect(within(dep).getByText('In')).toBeTruthy();
    expect(within(dep).getByText('+5,000')).toBeTruthy();
    expect(within(wd).getByText('Out')).toBeTruthy();
    expect(within(wd).getByText('Balance after 3,800')).toBeTruthy();
    expect(screen.getByText('Balance on')).toBeTruthy();
  });

  it('exports money in under In and money out under Out', () => {
    render(<AccountHistory events={rows} currency="EGP" lang="en" now={NOW} mode="cash" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const csv = vi.mocked(downloadTextFile).mock.calls[0][1] as string;
    expect(csv).toMatch(/"Money in",.*,"","5000","5000"/);
    expect(csv).toMatch(/"Money out",.*,"1200","","3800"/);
  });
});
