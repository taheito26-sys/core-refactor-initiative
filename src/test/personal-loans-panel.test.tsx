import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/i18n', () => {
  const t = Object.assign((key: string) => key, { lang: 'en', isRTL: false });
  return { useT: () => t };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const add = vi.fn(async () => 'loan-1');
const setRepayments = vi.fn(async () => {});
vi.mock('@/features/net-position/api', () => ({
  usePersonalLoanActions: () => ({ add, setRepayments, remove: vi.fn(async () => {}) }),
}));

import { PersonalLoansPanel } from '@/features/net-position/components/PersonalLoansPanel';

const state = {
  cashAccounts: [{ id: 'hand', name: 'Hand', type: 'hand', currency: 'QAR', status: 'active', createdAt: 0 }],
  cashLedger: [{ id: 'a', ts: 1, type: 'deposit', accountId: 'hand', direction: 'in', amount: 20000, currency: 'QAR' }],
} as never;

describe('PersonalLoansPanel', () => {
  it('adds a loan to a friend and takes it out of the chosen cash account, linked to the loan', async () => {
    const applyState = vi.fn();
    render(<PersonalLoansPanel state={state} applyState={applyState} loans={[]} unavailable={false} lang="en" />);
    fireEvent.change(screen.getByLabelText('plPerson'), { target: { value: 'Ahmed' } });
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '7000' } });
    fireEvent.change(screen.getByLabelText('plTakenFrom'), { target: { value: 'hand' } });
    fireEvent.click(screen.getByText('plAdd'));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const input = add.mock.calls[0][0] as { person: string; principal: number; currency: string; ledgerEntryId?: string };
    expect(input).toMatchObject({ person: 'Ahmed', principal: 7000, currency: 'QAR' });
    await waitFor(() => expect(applyState).toHaveBeenCalled());
    const entry = applyState.mock.calls[0][0].cashLedger.at(-1);
    expect(entry).toMatchObject({ type: 'loan_disbursement', direction: 'out', amount: 7000, accountId: 'hand', linkedEntityId: 'loan-1', id: input.ledgerEntryId });
  });

  it('refuses a loan larger than the account holds, and leaves cash alone when no account is chosen', async () => {
    add.mockClear();
    const applyState = vi.fn();
    render(<PersonalLoansPanel state={state} applyState={applyState} loans={[]} unavailable={false} lang="en" />);
    fireEvent.change(screen.getByLabelText('plPerson'), { target: { value: 'Omar' } });
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText('plTakenFrom'), { target: { value: 'hand' } });
    fireEvent.click(screen.getByText('plAdd'));
    expect(add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('plTakenFrom'), { target: { value: '' } });
    fireEvent.click(screen.getByText('plAdd'));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(applyState).not.toHaveBeenCalled();
  });

  it('records a part repayment on an open loan', async () => {
    const loan = { id: 'l1', person: 'Ahmed', principal: 7000, currency: 'QAR', lentAt: Date.now() - 86400000, repayments: [] };
    render(<PersonalLoansPanel state={state} applyState={vi.fn()} loans={[loan] as never} unavailable={false} lang="en" />);
    fireEvent.click(screen.getByText('plRecordRepayment', { exact: false }));
    fireEvent.change(screen.getAllByLabelText('amount', { exact: false }).at(-1) as HTMLElement, { target: { value: '2000' } });
    fireEvent.click(screen.getByText('plSaveRepayment'));
    await waitFor(() => expect(setRepayments).toHaveBeenCalledTimes(1));
    const [id, list] = setRepayments.mock.calls[0] as unknown as [string, Array<{ amount: number }>];
    expect(id).toBe('l1');
    expect(list.at(-1)?.amount).toBe(2000);
  });
});
