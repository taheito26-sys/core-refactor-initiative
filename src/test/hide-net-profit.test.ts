import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const updateUser = vi.fn(() => Promise.resolve({ data: {}, error: null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { updateUser } } }));
const auth = { user: { id: 'u1', user_metadata: {} as Record<string, unknown> } };
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => auth }));

const load = async () => {
  vi.resetModules();
  return import('@/features/dashboard/hide-net-profit');
};

describe('hiding the monthly net profit', () => {
  beforeEach(() => { localStorage.clear(); updateUser.mockClear(); auth.user.user_metadata = {}; });

  it('is shown until the merchant hides it', async () => {
    const m = await load();
    m.loadHiddenNetProfit('u1', {});
    expect(localStorage.getItem('dh-hide-net-profit:u1')).toBeNull();
  });

  it('keeps the choice on the device and on the account', async () => {
    const m = await load();
    m.setHiddenNetProfit('u1', true);
    expect(localStorage.getItem('dh-hide-net-profit:u1')).toBe('1');
    expect(updateUser).toHaveBeenCalledWith({ data: { hide_net_profit: true } });
  });

  it('remembers it after the app is closed and reopened, until toggled back', async () => {
    const first = await load();
    const a = renderHook(() => first.useHiddenNetProfit());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1]());
    expect(a.result.current[0]).toBe(true);
    a.unmount();

    const reopened = await load();
    const b = renderHook(() => reopened.useHiddenNetProfit());
    expect(b.result.current[0]).toBe(true);
    act(() => b.result.current[1]());
    expect(b.result.current[0]).toBe(false);
    expect(localStorage.getItem('dh-hide-net-profit:u1')).toBe('0');
  });

  it('follows the account on a new device, where nothing is stored locally', async () => {
    const m = await load();
    m.loadHiddenNetProfit('u2', { hide_net_profit: true });
    expect(localStorage.getItem('dh-hide-net-profit:u2')).toBe('1');
  });

  it('keeps each merchant on the same device separate', async () => {
    const m = await load();
    m.setHiddenNetProfit('u1', true);
    expect(localStorage.getItem('dh-hide-net-profit:u3')).toBeNull();
  });
});
