import { describe, expect, it, beforeEach, vi } from 'vitest';
import { saveTrackerState, saveTrackerStateNow } from '@/lib/tracker-sync';
import { activateTrackerClearBarrier } from '@/lib/tracker-backup';

const { authGetUserMock, selectMock, rpcMock, deleteMock, deleteEqMock, eqMock, fromMock } = vi.hoisted(() => {
  const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const deleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock, delete: deleteMock }));
  const authGetUserMock = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  return { authGetUserMock, selectMock, rpcMock, deleteMock, deleteEqMock, eqMock, fromMock };
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
    localStorage.clear();
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('overwrites the cloud snapshot when replaceExisting is enabled', async () => {
    const emptyState = {
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

    expect(selectMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteEqMock).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rpcMock).toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: emptyState,
        _write_generation: expect.any(Number),
      }),
    );
    expect(localStorage.getItem('tracker_state')).toBe(JSON.stringify(emptyState));
  });

  it('keeps the persistent cleared-data marker during destructive clears', async () => {
    const emptyState = {
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

    await saveTrackerStateNow(emptyState, { replaceExisting: true, preserveDataCleared: true });

    expect(localStorage.getItem('tracker_data_cleared')).toBe('true');
  });

  it('allows an explicit clear-state write while the barrier is active', async () => {
    const emptyState = {
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
        _state: emptyState,
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

    await saveTrackerStateNow(partialState as never, {
      replaceExisting: true,
      preserveDataCleared: true,
      allowDuringClear: true,
    });

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

    await saveTrackerStateNow(dirtyState as never, { replaceExisting: true });

    expect(rpcMock).not.toHaveBeenCalledWith(
      'save_tracker_snapshot_if_newer',
      expect.objectContaining({
        _user_id: 'user-1',
        _state: dirtyState,
      }),
    );
  });
});
