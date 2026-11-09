import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '@/pages/auth/LoginPage';
const mocks = vi.hoisted(() => ({ login: vi.fn(), google: vi.fn() }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ login: mocks.login, loginWithGoogle: mocks.google, devLogin: vi.fn(), isAuthenticated: false }) }));
vi.mock('@/lib/theme-context', () => ({ useTheme: () => ({ settings: { language: 'en' }, update: vi.fn() }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { isRTL: false }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
function show() { render(<MemoryRouter><LoginPage /></MemoryRouter>); }
it('releases the buttons when sign-in completes', async () => {
  mocks.google.mockResolvedValue(undefined); show();
  fireEvent.click(screen.getByRole('button', { name: 'continueWithGoogle' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'continueWithGoogle' })).not.toBeDisabled());
});
it('ends a hung OAuth spinner and reports connectivity rather than bad credentials', async () => {
  vi.useFakeTimers(); mocks.google.mockImplementation(() => new Promise(() => {})); show();
  fireEvent.click(screen.getByRole('button', { name: 'continueWithGoogle' }));
  expect(screen.getByRole('button', { name: 'Sign in' })).toHaveTextContent('Sign in');
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByText('loginConnectionError')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'continueWithGoogle' })).not.toBeDisabled();
});
it('releases a stuck password login without showing a spinner on the Google button', async () => {
  vi.useFakeTimers(); mocks.login.mockImplementation(() => new Promise(() => {})); show();
  fireEvent.change(screen.getByPlaceholderText('Username or email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('button', { name: 'continueWithGoogle' }).querySelector('.animate-spin')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByText('loginConnectionError')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
});
it('distinguishes invalid credentials from a connection failure', async () => {
  mocks.login.mockRejectedValue({ code: 'invalid_credentials', message: 'Invalid login credentials' }); show();
  fireEvent.change(screen.getByPlaceholderText('Username or email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByText('loginInvalidCredentials')).toBeInTheDocument());
  expect(screen.queryByText('loginConnectionError')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
});
