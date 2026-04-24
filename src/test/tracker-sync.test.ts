import { describe, expect, it, beforeEach, vi } from 'vitest';
import { saveTrackerStateNow } from '@/lib/tracker-sync';

const { authGetUserMock, selectMock, upsertMock, deleteMock, deleteEqMock, eqMock, fromMock } = vi.hoisted(() => {
  const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const deleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock, upsert: upsertMock, delete: deleteMock }));
  const authGetUserMock = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  return { authGetUserMock, selectMock, upsertMock, deleteMock, deleteEqMock, eqMock, fromMock };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: authGetUserMock,
    },
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
      range: '7d',
      settings: { lowStockThreshold: 5000, priceAlertThreshold: 2 },
      cal: { year: 2026, month: 3, selectedDay: null },
    };

    await saveTrackerStateNow(emptyState, { replaceExisting: true });

    expect(selectMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteEqMock).toHaveBeenCalledWith('user_id', 'user-1');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        state: emptyState,
      }),
      expect.any(Object),
    );
    expect(localStorage.getItem('tracker_state')).toBe(JSON.stringify(emptyState));
  });
});
