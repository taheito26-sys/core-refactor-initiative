import { describe, expect, it, vi, beforeEach } from 'vitest';
import { saveCashToCloud, encodeNoteWithBreakdown, decodeNoteWithBreakdown } from '@/lib/cash-sync';

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
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('skips stale cash writes while a destructive clear is active', async () => {
    localStorage.setItem('tracker_data_cleared', 'true');

    await saveCashToCloud([], []);

    expect(authGetUserMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
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
