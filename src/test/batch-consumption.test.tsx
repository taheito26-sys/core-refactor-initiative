import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' } }) }));
import { BatchConsumption } from '@/features/stock/components/BatchConsumption';
afterEach(cleanup);
describe('FIFO consumption beside the batch status', () => {
  it('shows both real quantities for a partial batch', () => {
    render(<BatchConsumption initial={30000} remaining={16832} />);
    const bar = screen.getByRole('progressbar', { name: 'Usage' });
    expect(bar.getAttribute('aria-valuenow')).toBe('43.89');
    expect(bar.getAttribute('aria-valuetext')).toContain('13,168 USDT');
    expect(bar.getAttribute('aria-valuetext')).toContain('16,832 USDT');
    expect(screen.getByText('13,168')).toBeTruthy(); expect(screen.getByText('16,832')).toBeTruthy();
  });
  it('fills the used segment for a depleted batch', () => {
    render(<BatchConsumption initial={5000} remaining={0} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toContain('Remaining: 0 USDT');
    expect(document.querySelector<HTMLElement>('.batch-consumption-fill')?.style.width).toBe('100%');
  });
  it('leaves a fresh batch fully remaining and updates after FIFO consumption', () => {
    const { rerender } = render(<BatchConsumption initial={5000} remaining={5000} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByRole('progressbar').getAttribute('data-empty')).toBe('false');
    rerender(<BatchConsumption initial={5000} remaining={1250} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75');
    expect(screen.getByText('3,750')).toBeTruthy();
  });
  it('handles zero quantities and clamps out-of-range remaining values', () => {
    const { rerender } = render(<BatchConsumption initial={0} remaining={0} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByRole('progressbar').getAttribute('data-empty')).toBe('true');
    rerender(<BatchConsumption initial={100} remaining={-10} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(<BatchConsumption initial={100} remaining={200} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    rerender(<BatchConsumption initial={Number.NaN} remaining={Number.NaN} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});
