import { describe, expect, it, vi, beforeEach } from 'vitest';
import { saveCashToCloud, encodeNoteWithBreakdown, decodeNoteWithBreakdown, loadCashFromCloud, resetCashSyncSession, clearCashStateFromCloud } from '@/lib/cash-sync';
import { activateTrackerClearBarrier } from '@/lib/tracker-backup';

const { authGetUserMock, fromMock } = vi.hoisted(() => {
  const authGetUserMock = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  const fromMock = vi.fn();
  return { authGetUserMock, fromMock };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: authGetUserMock,
    },
    from: fromMock,
  },
}));

describe('saveCashToCloud', () => {
  beforeEach(() => {
    resetCashSyncSession();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('skips stale cash writes while a destructive clear is active', async () => {
    localStorage.setItem('tracker_data_cleared', 'true');

    await saveCashToCloud([], []);

    expect(authGetUserMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });
  function cashDatabase() {
    const upserts = vi.fn(async (_table: string, _rows: unknown): Promise<{ error: { message: string } | null }> => ({ error: null }));
    const deletes = vi.fn();
    const read = vi.fn(async () => ({ data: [], error: null as { message: string } | null }));
    fromMock.mockImplementation((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        not: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        order: () => read(),
        upsert: (rows: unknown) => upserts(table, rows),
        delete: () => { deletes(table); return query; },
        then: (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return query;
    });
    return { upserts, deletes, read };
  }

  const account = { id: 'a1', name: 'Cash', type: 'hand' as const, currency: 'QAR' as const, status: 'active' as const, createdAt: 1 };
  const entry = { id: 'e1', accountId: 'a1', ts: 1, type: 'deposit' as const, direction: 'in' as const, amount: 10, currency: 'QAR' as const };

  it('requires a successful cloud load before writing cash', async () => {
    const db = cashDatabase();
    await expect(saveCashToCloud([account], [entry])).rejects.toThrow('Load current cash');
    expect(db.upserts).not.toHaveBeenCalled();
  });

  it('does not carry another account’s loaded flag into a new session', async () => {
    const db = cashDatabase();
    await loadCashFromCloud();
    authGetUserMock.mockResolvedValueOnce({ data: { user: { id: 'user-2' } } });
    await expect(saveCashToCloud([account], [entry])).rejects.toThrow('Load current cash');
    expect(db.upserts).not.toHaveBeenCalled();
  });

  it('reports account save failures instead of acknowledging a durable commit', async () => {
    const db = cashDatabase();
    await loadCashFromCloud();
    db.upserts.mockResolvedValueOnce({ error: { message: 'denied' } });
    await expect(saveCashToCloud([account], [entry])).rejects.toThrow('denied');
    expect(db.upserts).toHaveBeenCalledTimes(1);
  });

  it('stops a pending save before ledger writes if a clear begins', async () => {
    const db = cashDatabase();
    await loadCashFromCloud();
    let release!: (value: { error: null }) => void;
    db.upserts.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const pending = saveCashToCloud([account], [entry]);
    await vi.waitFor(() => expect(db.upserts).toHaveBeenCalledTimes(1));
    activateTrackerClearBarrier();
    release({ error: null });
    await expect(pending).rejects.toThrow('cancelled');
    expect(db.upserts).toHaveBeenCalledTimes(1);
    expect(db.deletes).not.toHaveBeenCalled();
  });

  it('does not allow writes after a failed initial cloud read', async () => {
    const db = cashDatabase();
    db.read.mockResolvedValueOnce({ data: [], error: { message: 'offline' } });
    expect(await loadCashFromCloud()).toBeNull();
    await expect(saveCashToCloud([account], [entry])).rejects.toThrow('Load current cash');
    expect(db.upserts).not.toHaveBeenCalled();
  });

  it('reports a failed explicit clear', async () => {
    fromMock.mockImplementation(() => ({ delete: () => ({ eq: async () => ({ error: { message: 'denied' } }) }) }));
    await expect(clearCashStateFromCloud()).rejects.toThrow('Cash clear failed');
  });

  it('waits for already dispatched cash writes before deleting rows', async () => {
    const db = cashDatabase();
    await loadCashFromCloud();
    let release!: (value: { error: null }) => void;
    db.upserts.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const pending = saveCashToCloud([account], [entry]);
    const cancelled = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(db.upserts).toHaveBeenCalledTimes(1));
    const clear = clearCashStateFromCloud();
    expect(db.deletes).not.toHaveBeenCalled();
    release({ error: null });
    await cancelled;
    await clear;
    expect(db.deletes).toHaveBeenCalledTimes(2);
  });

  it('restores cash rows only for the explicitly requested account', async () => {
    const db = cashDatabase();
    await saveCashToCloud([account], [entry], true, 'user-1');
    expect(db.upserts).toHaveBeenCalledWith('cash_accounts', [expect.objectContaining({ id: 'a1', user_id: 'user-1' })]);
    expect(db.upserts).toHaveBeenCalledWith('cash_ledger', [expect.objectContaining({ id: 'e1', user_id: 'user-1' })]);
    expect(db.deletes).toHaveBeenCalledTimes(2);
  });

  it('does not treat an incidental empty save as a clear', async () => {
    const db = cashDatabase();
    await loadCashFromCloud();
    await saveCashToCloud([], [], true);
    expect(db.deletes).not.toHaveBeenCalled();
  });

});

describe('encodeNoteWithBreakdown / decodeNoteWithBreakdown', () => {
  it('round-trips a note with a banknote breakdown through the note column', () => {
    const breakdown = { 500: 123, 200: 21, 100: 13, 50: 20 };
    const encoded = encodeNoteWithBreakdown('Hasan payment #12', breakdown);
    expect(encoded).toMatch(/^Hasan payment #12 \[\[bn:[\d,x]+\]\]$/);

    const decoded = decodeNoteWithBreakdown(encoded);
    expect(decoded.note).toBe('Hasan payment #12');
    expect(decoded.banknoteBreakdown).toEqual(breakdown);
  });

  it('round-trips a breakdown with no note text', () => {
    const encoded = encodeNoteWithBreakdown(undefined, { 100: 5 });
    expect(encoded).toBe('[[bn:100x5]]');

    const decoded = decodeNoteWithBreakdown(encoded);
    expect(decoded.note).toBeUndefined();
    expect(decoded.banknoteBreakdown).toEqual({ 100: 5 });
  });

  it('leaves a plain note untouched when there is no breakdown', () => {
    expect(encodeNoteWithBreakdown('Source, reason...', undefined)).toBe('Source, reason...');
    expect(decodeNoteWithBreakdown('Source, reason...')).toEqual({ note: 'Source, reason...' });
  });

  it('returns null/empty for an empty note and no breakdown', () => {
    expect(encodeNoteWithBreakdown(undefined, undefined)).toBeNull();
    expect(decodeNoteWithBreakdown(null)).toEqual({});
    expect(decodeNoteWithBreakdown(undefined)).toEqual({});
  });

  it('ignores zero-count denominations', () => {
    const encoded = encodeNoteWithBreakdown('note', { 500: 0, 100: 5 });
    expect(encoded).toBe('note [[bn:100x5]]');
  });
});

describe('expense category marker', () => {
  it('round-trips a category, alone or with a banknote breakdown', () => {
    expect(decodeNoteWithBreakdown(encodeNoteWithBreakdown('Office', undefined, 'rent'))).toEqual({ note: 'Office', expenseCategory: 'rent' });
    const both = encodeNoteWithBreakdown('Office', { 100: 5 }, 'rent');
    expect(decodeNoteWithBreakdown(both)).toEqual({ note: 'Office', banknoteBreakdown: { 100: 5 }, expenseCategory: 'rent' });
  });
  it('leaves a note with no category untouched', () => {
    expect(encodeNoteWithBreakdown('Office', undefined, undefined)).toBe('Office');
  });
});
