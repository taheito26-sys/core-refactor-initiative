import { describe, expect, it, vi, beforeEach } from 'vitest';
import { saveCashToCloud } from '@/lib/cash-sync';

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
