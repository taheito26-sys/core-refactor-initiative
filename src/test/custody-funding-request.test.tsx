import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MerchantCustodyModal } from '@/features/stock/components/CashManagement';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
const account = { id: 'zakaria-account', name: 'Zakaria', type: 'merchant_custody' as const, merchantId: 'zakaria', currency: 'QAR' as const, status: 'active' as const, createdAt: 1 };
const counterparties = [{ relationshipId: 'relationship', counterpartyMerchantId: 'zakaria', counterpartyUserId: 'zakaria-user', counterpartyLabel: 'Zakaria', status: 'active' }];
afterEach(cleanup);
describe('custody Add Cash request form', () => {
  it('preselects the account recipient and sends the actual 10,500 funding request', () => {
    const onSubmit = vi.fn();
    render(<MerchantCustodyModal initialAccount={account} counterparties={counterparties} myMerchantId="me" myUserId="my-user" onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByLabelText('selectMerchantCustodian')).toHaveTextContent('Zakaria');
    expect(screen.queryByRole('combobox', { name: 'selectMerchantCustodian' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('currency')).toHaveTextContent('QAR');
    expect(screen.queryByRole('combobox', { name: 'currency' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '10500' } });
    fireEvent.click(screen.getByText('sendCustodyRequest'));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ custodianMerchantId: 'zakaria', custodianUserId: 'zakaria-user', requesterMerchantId: 'me', relationshipId: 'relationship', amount: 10500, currency: 'QAR', note: undefined });
  });
  it('repairs the legacy account case from an exact approved recipient label', () => {
    const onSubmit = vi.fn();
    render(<MerchantCustodyModal initialAccount={{ ...account, merchantId: undefined, name: 'Custody — Zakaria' }} counterparties={counterparties} myMerchantId="me" myUserId="my-user" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '10500' } });
    fireEvent.click(screen.getByText('sendCustodyRequest'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ custodianUserId: 'zakaria-user', amount: 10500 }));
    expect(screen.queryByText('missingMerchantUserMapping')).not.toBeInTheDocument();
  });
  it('still offers recipient selection for a new custody request', () => {
    render(<MerchantCustodyModal counterparties={counterparties} myMerchantId="me" myUserId="my-user" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'selectMerchantCustodian' })).toBeInTheDocument();
  });
  it('does not substitute a different merchant when account mapping is unavailable', () => {
    const onSubmit = vi.fn();
    render(<MerchantCustodyModal initialAccount={{ ...account, merchantId: 'unmapped' }} counterparties={counterparties} myMerchantId="me" myUserId="my-user" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '10500' } });
    fireEvent.click(screen.getByText('sendCustodyRequest'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/invalidRelationship/)).toBeTruthy();
  });
});
