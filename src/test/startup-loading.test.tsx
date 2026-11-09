import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StartupLoading } from '@/features/auth/StartupLoading';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('offers recovery after a startup stall without exposing a protected page', () => {
  vi.useFakeTimers();
  render(<StartupLoading />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(12000); });
  expect(screen.getByText('startupDelayed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'startupRetry' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});
