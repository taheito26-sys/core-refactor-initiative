import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { isRTL: false }) }));
import { UpdateCard } from '@/features/app-updates/UpdateCard';
afterEach(cleanup);
describe('automatic update status', () => {
  it('shows progress and completion without an acceptance button', () => {
    const view = render(<UpdateCard phase="updating" />);
    expect(screen.getByRole('status').textContent).toContain('appUpdateAutomatic');
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<UpdateCard phase="complete" />);
    expect(screen.getByRole('status').textContent).toContain('appUpdateComplete');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows the failed save reason without a spinner or approval button', () => {
    const { container } = render(<UpdateCard phase="failed" error="Write rejected" />);
    expect(screen.getByText('Write rejected')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

});
