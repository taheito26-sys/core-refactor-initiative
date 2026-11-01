import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSnapshot, saveSnapshot, commitSnapshot, refreshEvents } = vi.hoisted(() => ({ loadSnapshot: vi.fn(), saveSnapshot: vi.fn(), commitSnapshot: vi.fn(), refreshEvents: [] as Array<() => void> }));
vi.mock('@/lib/tracker-sync', () => ({
  loadTrackerStateFromCloud: loadSnapshot,
  saveTrackerState: saveSnapshot,
  saveTrackerStateNow: commitSnapshot,
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@/lib/cash-sync', () => ({ loadCashFromCloud: async () => ({ accounts: [], ledger: [] }), saveCashToCloud: async () => {} }));
vi.mock('@/lib/vault-auto-trigger', () => ({ triggerVaultBackup: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    channel: () => {
      const channel = { on: (_event: string, _filter: unknown, callback: () => void) => { refreshEvents.push(callback); return channel; }, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

import { useTrackerState } from '@/lib/useTrackerState';
import { type TrackerState, type Trade, type Customer } from '@/lib/tracker-helpers';


describe('durable order submission', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); refreshEvents.length = 0;
    loadSnapshot.mockResolvedValue({ state: {}, cleared: false });
    commitSnapshot.mockResolvedValue(undefined);
  });
  const withOrder = (state: TrackerState): TrackerState => ({ ...state,
    customers: [{ id: 'buyer', name: 'Mohamed Al-Damrawy' } as Customer],
    trades: [{ id: 'order-105368389285', customerId: 'buyer', ts: 1, amountUSDT: 1800.82, sellPriceQAR: 3.83, feeQAR: 0, usesStock: false, note: '', revisions: [], importedFrom: 'okx', exchangeOrderNumber: '105368389285', voided: false } as Trade],
  });
  it('does not publish the new order until the server acknowledges it, then restores it on remount', async () => {
    let accept: () => void = () => {};
    commitSnapshot.mockImplementationOnce((state: TrackerState) => new Promise<void>(resolve => {
      accept = () => { loadSnapshot.mockResolvedValue({ state, cleared: false }); resolve(); };
    }));
    const first = renderHook(() => useTrackerState());
    await waitFor(() => expect(first.result.current.cloudLoaded).toBe(true));
    const next = withOrder(first.result.current.state);
    let saving!: Promise<void>;
    act(() => { saving = first.result.current.applyStateAndCommit(next); });
    expect(first.result.current.state.trades).toHaveLength(0);
    await act(async () => { accept(); await saving; });
    expect(first.result.current.state.trades).toHaveLength(1);
    first.unmount();
    const reloaded = renderHook(() => useTrackerState());
    await waitFor(() => expect(reloaded.result.current.cloudLoaded).toBe(true));
    expect(reloaded.result.current.state.trades.map(row => row.exchangeOrderNumber)).toEqual(['105368389285']);
    reloaded.unmount();
  });
  it('reports a rejected write and leaves the form state unpublished rather than falsely showing a saved order', async () => {
    commitSnapshot.mockRejectedValueOnce(new Error('Tracker write rejected'));
    const hook = renderHook(() => useTrackerState());
    await waitFor(() => expect(hook.result.current.cloudLoaded).toBe(true));
    await act(async () => { await expect(hook.result.current.applyStateAndCommit(withOrder(hook.result.current.state))).rejects.toThrow('Tracker write rejected'); });
    expect(hook.result.current.state.trades).toHaveLength(0);
    hook.unmount();
  });
  it('discards a stale refresh that began before a confirmed order submission', async () => {
    const hook = renderHook(() => useTrackerState());
    await waitFor(() => expect(hook.result.current.cloudLoaded && refreshEvents.length > 0).toBe(true));
    let finishRead!: (snapshot: { state: Partial<TrackerState>; cleared: boolean }) => void;
    loadSnapshot.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    act(() => { refreshEvents[0](); });
    await waitFor(() => expect(finishRead).toBeDefined(), { timeout: 1500 });
    await act(async () => { await hook.result.current.applyStateAndCommit(withOrder(hook.result.current.state)); });
    await act(async () => { finishRead({ state: {}, cleared: false }); });
    expect(hook.result.current.state.trades).toHaveLength(1);
    hook.unmount();
  });
  it('keeps refresh blocked until a slow commit actually completes rather than expiring after eight seconds', async () => {
    const hook = renderHook(() => useTrackerState());
    await waitFor(() => expect(hook.result.current.cloudLoaded && refreshEvents.length > 0).toBe(true));
    let finish!: () => void;
    commitSnapshot.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    let saving!: Promise<void>;
    act(() => { saving = hook.result.current.applyStateAndCommit(withOrder(hook.result.current.state)); });
    const reads = loadSnapshot.mock.calls.length;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000);
    try {
      act(() => { refreshEvents[0](); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
      expect(loadSnapshot).toHaveBeenCalledTimes(reads);
      await act(async () => { finish(); await saving; });
      expect(hook.result.current.state.trades).toHaveLength(1);
    } finally { clock.mockRestore(); hook.unmount(); }
  });

});
