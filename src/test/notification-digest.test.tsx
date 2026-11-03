import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNotificationDigest } from '@/lib/notification-digest';
const { query, getUser } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn() };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  return { query, getUser: vi.fn() };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getUser }, from: () => query } }));
import { NotificationDigest } from '@/components/notifications/NotificationDigest';
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  query.limit.mockResolvedValue({ data: [{ category: 'approval' }, { category: 'approval' }, { category: 'trade' }], error: null });
});
afterEach(cleanup);
describe('Supabase notification digest', () => {
  it('summarizes category counts and handles no unread notifications', () => {
    expect(buildNotificationDigest([]).count).toBe(0);
    const digest = buildNotificationDigest([{ category: 'approval' }, { category: 'approval' }, { category: null }]);
    expect(digest.categories).toEqual({ approval: 2, other: 1 });
    expect(digest.summary).toContain('2 approval notifications');
  });
  it('reads only the signed-in user unread categories and renders the digest', async () => {
    render(<NotificationDigest />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText(/You have 3 unread notifications/)).toBeTruthy();
    expect(query.select).toHaveBeenCalledWith('category');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(query.is).toHaveBeenCalledWith('read_at', null);
    expect(query.limit).toHaveBeenCalledWith(30);
  });
  it('does not read notifications without an authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    render(<NotificationDigest />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText('Sign in to view your notification digest.')).toBeTruthy();
    expect(query.select).not.toHaveBeenCalled();
  });
});
