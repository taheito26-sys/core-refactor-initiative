import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSnapshot, saveSnapshot } = vi.hoisted(() => ({ loadSnapshot: vi.fn(), saveSnapshot: vi.fn() }));
vi.mock('@/lib/tracker-sync', () => ({
  loadTrackerStateFromCloud: loadSnapshot,
  saveTrackerState: saveSnapshot,
  saveTrackerStateNow: vi.fn(async () => {}),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@/lib/cash-sync', () => ({ loadCashFromCloud: async () => ({ accounts: [], ledger: [] }), saveCashToCloud: async () => {} }));
vi.mock('@/lib/vault-auto-trigger', () => ({ triggerVaultBackup: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

import { useTrackerState } from '@/lib/useTrackerState';
import { activateTrackerClearBarrier } from '@/lib/tracker-backup';

describe('tracker recovery after a clear', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    activateTrackerClearBarrier();
  });

  it('allows new data after the cleared cloud state has been loaded', async () => {
    loadSnapshot.mockResolvedValue({ state: {}, cleared: true });
    const { result } = renderHook(() => useTrackerState());
    await waitFor(() => expect(result.current.cloudLoaded).toBe(true));
    expect(result.current.state.customers).toEqual([]);
    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
    act(() => result.current.applyState({ ...result.current.state, customers: [{ id: 'new', name: 'New buyer', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '', createdAt: 1 }] }));
    expect(localStorage.getItem('tracker_data_cleared')).toBeNull();
    expect(result.current.state.customers.map(c => c.id)).toEqual(['new']);
  });

  it('does not lift the barrier before the cleared state is confirmed', async () => {
    loadSnapshot.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTrackerState());
    await act(async () => {});
    const hydrationSaves = saveSnapshot.mock.calls.length;
    expect(() => result.current.applyState(result.current.state)).toThrow('Reload the cleared tracker');
    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
    expect(saveSnapshot).toHaveBeenCalledTimes(hydrationSaves);
  });
});
