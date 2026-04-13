import { describe, expect, it } from 'vitest';
import { smartGroupNotifications } from '@/lib/notification-grouping';
import { mapNotificationRowToModel } from '@/types/notifications';

describe('notification grouping', () => {
  it('groups by dedupe key and returns all ids', () => {
    const base = { title: 'A', body: null, category: 'message', read_at: null, created_at: new Date().toISOString(), conversation_id: 'c1', dedupe_key: 'k1' };
    const items = [
      mapNotificationRowToModel({ id: '1', ...base }),
      mapNotificationRowToModel({ id: '2', ...base }),
      mapNotificationRowToModel({ id: '3', ...base }),
    ];
    const grouped = smartGroupNotifications(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].groupIds).toEqual(['1', '2', '3']);
  });
});
