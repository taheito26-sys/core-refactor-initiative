import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state: { data: { buy: number; fetchedAt: number } | null | undefined } = { data: undefined };
vi.mock('@/features/customer/bank-rate/useBankMisrRate', () => ({ useBankMisrRate: () => ({ data: state.data }) }));

import { BankMisrRateKpi } from '@/features/customer/bank-rate/BankMisrRateKpi';

describe('BankMisrRateKpi', () => {
  it('shows the Bank Misr QAR buy price with four decimals and its unit', () => {
    state.data = { buy: 13.9745, fetchedAt: Date.UTC(2026, 10, 9, 12, 30) };
    render(<BankMisrRateKpi lang="en" />);
    expect(screen.getByText('Bank Misr Price')).toBeTruthy();
    expect(screen.getByText('13.9745')).toBeTruthy();
    expect(screen.getByText('EGP / QAR')).toBeTruthy();
    expect(screen.getByText(/QAR notes · buy/)).toBeTruthy();
  });

  it('is Arabic when the portal is Arabic', () => {
    state.data = { buy: 13.9745, fetchedAt: Date.now() };
    render(<BankMisrRateKpi lang="ar" />);
    expect(screen.getByText('سعر بنك مصر')).toBeTruthy();
  });

  it('renders nothing while there is no rate, never a dash or a zero', () => {
    state.data = null;
    const { container } = render(<BankMisrRateKpi lang="en" />);
    expect(container.firstChild).toBeNull();
  });
});
