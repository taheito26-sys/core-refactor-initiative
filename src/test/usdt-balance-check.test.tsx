import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsdtBalanceCheck } from '@/features/stock/components/UsdtBalanceCheck';
import type { ComponentProps } from 'react';
vi.mock('@/lib/i18n', () => ({ useT: () => ({ lang: 'en', isRTL: false }) }));
vi.mock('@/features/stock/components/UsdtBalanceWorkspace', () => ({
  UsdtBalanceWorkspace: ({ onReviewAll }: { onReviewAll: () => void }) => <div>Private balance comparison<button onClick={onReviewAll}>All movements</button></div>,
}));
const props = { onReviewAll: vi.fn(), onRecordTrade: vi.fn() } as unknown as ComponentProps<typeof UsdtBalanceCheck>;
describe('opt-in balance check', () => {
  it('keeps the workspace unmounted until the user opens it and closes normally', () => {
    render(<UsdtBalanceCheck {...props} />);
    expect(screen.queryByText('Private balance comparison')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check balances' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Private balance comparison')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Private balance comparison')).not.toBeInTheDocument();
  });
  it('closes the check before navigating to movement history', () => {
    render(<UsdtBalanceCheck {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check balances' }));
    fireEvent.click(screen.getByRole('button', { name: 'All movements' }));
    expect(props.onReviewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
