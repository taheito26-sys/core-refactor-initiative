import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadTrackerStateFromCloud, saveTrackerState, saveTrackerStateNow, resetTrackerSyncSession } from '@/lib/tracker-sync';
import type { TrackerState } from '@/lib/tracker-helpers';
import { activateTrackerClearBarrier } from '@/lib/tracker-backup';

const { authGetUserMock, selectMock, rpcMock, deleteMock, deleteEqMock, eqMock, fromMock, merchantMaybeSingleMock, merchantMembersEqMock, snapshotInMock, maybeSingleMock } = vi.hoisted(() => {
  const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const merchantMaybeSingleMock = vi.fn().mockResolvedValue({ data: { merchant_id: 'merchant-1' }, error: null });
  const merchantMembersEqMock = vi.fn().mockResolvedValue({ data: [{ user_id: 'user-1' }, { user_id: 'user-2' }], error: null });
  const snapshotInMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const selectMock = vi.fn((columns: string) => {
    if (columns.includes('merchant_id')) {
      return { eq: vi.fn(() => ({ maybeSingle: merchantMaybeSingleMock })) };
    }
    if (columns.includes('user_id') && !columns.includes('state')) {
      return { eq: merchantMembersEqMock };
    }
    return { eq: eqMock, in: snapshotInMock };
  });
  const deleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock, delete: deleteMock }));
  const authGetUserMock = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  return { authGetUserMock, selectMock, rpcMock, deleteMock, deleteEqMock, eqMock, fromMock, merchantMaybeSingleMock, merchantMembersEqMock, snapshotInMock, maybeSingleMock };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: authGetUserMock,
    },
    rpc: rpcMock,
    from: fromMock,
  },
}));

describe('saveTrackerStateNow', () => {
  beforeEach(() => {
    resetTrackerSyncSession();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    rpcMock.mockResolvedValue({ data: true, error: null });
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    merchantMaybeSingleMock.mockResolvedValue({ data: { merchant_id: 'merchant-1' }, error: null });
    merchantMembersEqMock.mockResolvedValue({ data: [{ user_id: 'user-1' }, { user_id: 'user-2' }], error: null });
    snapshotInMock.mockResolvedValue({ data: [], error: null });
  });

  it('overwrites the cloud snapshot when replaceExisting is enabled', async () => {
    const emptyState: TrackerState = {
      batches: [],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 0,
      cashOwner: '',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: '30d',
      settings: { lowStockThreshold: 4200, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 4, selectedDay: null },
    };

    await saveTrackerStateNow(emptyState, { replaceExisting: true });

    expect(selectMock).toHaveBeenCalledWith('state, write_generation, is_cleared');
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteEqMock).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rpcMock).toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: expect.objectContaining(emptyState),
        _write_generation: expect.any(Number),
      }),
    );
    expect(localStorage.getItem('tracker_state')).toBe(JSON.stringify(emptyState));
  });

  it('keeps the persistent cleared-data marker during destructive clears', async () => {
    const emptyState: TrackerState = {
      batches: [],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 0,
      cashOwner: '',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: '7d',
      settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 3, selectedDay: null },
    };

    localStorage.setItem('tracker_data_cleared', 'true');

    await saveTrackerStateNow(emptyState, { replaceExisting: true, preserveDataCleared: true, allowDuringClear: true });

    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
  });

  it('allows an explicit clear-state write while the barrier is active', async () => {
    const emptyState: TrackerState = {
      batches: [],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 0,
      cashOwner: '',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: '7d',
      settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 3, selectedDay: null },
    };

    activateTrackerClearBarrier(localStorage);

    await saveTrackerStateNow(emptyState, {
      replaceExisting: true,
      preserveDataCleared: true,
      allowDuringClear: true,
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: expect.objectContaining(emptyState),
      }),
    );
    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
  });

  it('rejects partial payloads even when allowDuringClear is set', async () => {
    localStorage.setItem('tracker_data_cleared', 'true');

    const partialState = {
      batches: [],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 0,
      cashOwner: 'should-not-pass',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: 'all',
      settings: { lowStockThreshold: 3900, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 5, selectedDay: null },
    };

    await expect(saveTrackerStateNow(partialState as never, {
      replaceExisting: true,
      preserveDataCleared: true,
      allowDuringClear: true,
    })).rejects.toThrow('complete empty');

    expect(rpcMock).not.toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: partialState,
      }),
    );
  });

  it('preserves the cleared-data marker on ordinary empty-state saves', () => {
    localStorage.setItem('tracker_data_cleared', 'true');

    saveTrackerState({
      batches: [],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 0,
      cashOwner: '',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: '7d',
      settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 3, selectedDay: null },
    });

    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
  });

  it('blocks meaningful tracker writes while the clear barrier is active', async () => {
    localStorage.setItem('tracker_data_cleared', 'true');

    const dirtyState = {
      batches: [{ id: 'batch-1' }],
      trades: [],
      customers: [],
      suppliers: [],
      cashQAR: 100,
      cashOwner: 'owner',
      cashHistory: [],
      cashAccounts: [],
      cashLedger: [],
      currency: 'QAR',
      range: '7d',
      settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 3, selectedDay: null },
    };

    await expect(saveTrackerStateNow(dirtyState as never, { replaceExisting: true })).rejects.toThrow('cancelled');

    expect(rpcMock).not.toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: dirtyState,
      }),
    );
  });

  it('does not erase another merchant member when the current user clears their own snapshot', async () => {
    snapshotInMock.mockResolvedValueOnce({
      data: [
        {
          user_id: 'user-1',
          updated_at: '2026-04-02T00:00:00.000Z',
          is_cleared: true,
          write_generation: 12,
          state: {},
        },
        {
          user_id: 'user-2',
          updated_at: '2026-04-03T00:00:00.000Z',
          is_cleared: false,
          write_generation: 99,
          state: {
            cashQAR: 500,
            cashOwner: 'stale',
            cashAccounts: [{ id: 'cash-1' }],
            cashLedger: [{ id: 'entry-1' }],
          },
        },
      ],
      error: null,
    });

    const snapshot = await loadTrackerStateFromCloud();

    expect(snapshot).toEqual(
      expect.objectContaining({
        cleared: false,
        state: expect.objectContaining({ cashAccounts: [{ id: 'cash-1' }] }),
      }),
    );
  });
  it('rejects a server-fenced write and does not update local storage', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const { state } = (await import('@/lib/tracker-state')).createEmptyState();
    localStorage.setItem('tracker_state', '{"previous":true}');
    await expect(saveTrackerStateNow(state)).rejects.toThrow('another device');
    expect(localStorage.getItem('tracker_state')).toBe('{"previous":true}');
  });

  it('does not write after a failed prerequisite cloud read', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const { state } = (await import('@/lib/tracker-state')).createEmptyState();
    await expect(saveTrackerStateNow(state)).rejects.toThrow('Tracker read failed');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('cancels a pending write when a clear starts during authentication', async () => {
    let release!: (value: unknown) => void;
    authGetUserMock.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const { state } = (await import('@/lib/tracker-state')).createEmptyState();
    const pending = saveTrackerStateNow(state);
    activateTrackerClearBarrier(localStorage);
    release({ data: { user: { id: 'user-1' } }, error: null });
    await expect(pending).rejects.toThrow('cancelled');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('loads an own clear tombstone and synchronizes the generation fence', async () => {
    snapshotInMock.mockResolvedValueOnce({ data: [{ user_id: 'user-1', state: {}, is_cleared: true, write_generation: 12 }], error: null });
    expect(await loadTrackerStateFromCloud()).toEqual({ cleared: true, state: {} });
    expect(localStorage.getItem('tracker_write_generation')).toBe('12');
  });

  it('refuses stale state after a newer generation was written on another device', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { state: {}, write_generation: 12, is_cleared: true }, error: null });
    const { state } = (await import('@/lib/tracker-state')).createEmptyState();
    await expect(saveTrackerStateNow(state)).rejects.toThrow('another device');
    expect(rpcMock).not.toHaveBeenCalled();
  });

});
