import { describe, expect, it } from 'vitest';
import { notificationRoute, type Notification } from '@/hooks/useNotifications';

const base: Notification = {
  id: 'n1',
  title: 'msg',
  body: 'hello',
  category: 'message',
  read_at: null,
  created_at: new Date().toISOString(),
};

describe('notificationRoute', () => {
  it('routes chat notifications to exact conversation + message anchor', () => {
    const route = notificationRoute({
      ...base,
      relationship_id: 'rel-1',
      message_id: 'msg-99',
    });
    expect(route).toContain('/chat?');
    expect(route).toContain('conversation=rel-1');
    expect(route).toContain('message=msg-99');
  });

  it('prefers explicit route_path + route_params metadata', () => {
    const route = notificationRoute({
      ...base,
      category: 'approval',
      route_path: '/admin/approvals',
      route_params: { anchor: 'approval-1', tab: 'pending' },
    });
    expect(route).toContain('/admin/approvals?');
    expect(route).toContain('anchor=approval-1');
    expect(route).toContain('tab=pending');
  });
});
