import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

// Per-table results for the next reads of each profile table.
type Res = { data: unknown; error: { message: string } | null };
const results: Record<string, Res[]> = {};
const profileReads = vi.fn();
const nextFor = (table: string): Res => {
  profileReads(table);
  const q = results[table] ?? [];
  return q.length > 1 ? q.shift()! : q[0] ?? { data: null, error: null };
};
let authCallback: ((event: string, session: unknown) => void) | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => nextFor(table) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => { authCallback = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
    },
  },
}));
vi.mock('@/lib/session-scope', () => ({ claimLocalScope: () => false, releaseLocalScope: () => {} }));
vi.mock('@/lib/tracker-sync', () => ({ resetTrackerSyncSession: () => {} }));
vi.mock('@/lib/app-activity', () => ({ startAppActivityTracking: () => () => {} }));
vi.mock('@/platform/runtime', () => ({ getNativePlugin: () => null, isNativeApp: () => false }));
vi.mock('@/features/auth/auth-redirects', () => ({ getAuthFlowContext: () => ({}), isNativeRuntime: () => false }));

import { AuthProvider, useAuth } from '@/features/auth/auth-context';

const Probe = () => {
  const a = useAuth();
  return <div data-testid="s">{`${a.isLoading ? 'loading' : 'ready'}|${a.merchantProfile ? 'merchant' : 'none'}`}</div>;
};
const session = { user: { id: 'u1', email: 'a@b.c' } };
const ok = (data: unknown): Res => ({ data, error: null });
const bad: Res = { data: null, error: { message: 'timeout' } };

beforeEach(() => { for (const k of Object.keys(results)) delete results[k]; authCallback = null; profileReads.mockClear(); });

describe('profile loading', () => {
  it('shares profile requests during overlapping sign-in events and reads again after completion', async () => {
    results.profiles = [ok({ id: 'p', user_id: 'u1', status: 'approved', role: 'customer' })];
    results.merchant_profiles = [ok(null)];
    results.customer_profiles = [ok({ id: 'c', user_id: 'u1' })];
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {
      authCallback?.('INITIAL_SESSION', session);
      authCallback?.('SIGNED_IN', session);
    });
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('ready|none'));
    expect(profileReads).toHaveBeenCalledTimes(3);
    await act(async () => { authCallback?.('SIGNED_IN', session); });
    expect(profileReads).toHaveBeenCalledTimes(6);
  });

  it('keeps waiting instead of treating a failed merchant lookup as "no merchant profile"', async () => {
    results.profiles = [ok({ id: 'p', user_id: 'u1', status: 'approved', role: 'merchant' })];
    results.merchant_profiles = [bad, bad, bad, bad, bad, bad];
    results.customer_profiles = [ok(null)];
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { authCallback?.('INITIAL_SESSION', session); });
    await new Promise(r => setTimeout(r, 1500));
    expect(screen.getByTestId('s').textContent).toBe('loading|none');
  });

  it('recovers once the lookup succeeds', async () => {
    results.profiles = [ok({ id: 'p', user_id: 'u1', status: 'approved', role: 'merchant' })];
    results.merchant_profiles = [bad, bad, bad, ok({ id: 'm', user_id: 'u1', merchant_id: 'x' })];
    results.customer_profiles = [ok(null)];
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { authCallback?.('INITIAL_SESSION', session); });
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('ready|merchant'), { timeout: 6000 });
  });

  it('does not forget a known merchant profile when a later refresh fails', async () => {
    results.profiles = [ok({ id: 'p', user_id: 'u1', status: 'approved', role: 'merchant' })];
    results.merchant_profiles = [ok({ id: 'm', user_id: 'u1', merchant_id: 'x' })];
    results.customer_profiles = [ok(null)];
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { authCallback?.('INITIAL_SESSION', session); });
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('ready|merchant'));
    results.merchant_profiles = [bad];
    await act(async () => { authCallback?.('TOKEN_REFRESHED', session); });
    await new Promise(r => setTimeout(r, 1500));
    expect(screen.getByTestId('s').textContent).toBe('ready|merchant');
  });
});
