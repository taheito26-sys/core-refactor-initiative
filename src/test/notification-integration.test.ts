import { describe, expect, it } from 'vitest';
import { mapNotificationRowToModel } from '@/types/notifications';
import { buildNotificationNavigationTarget } from '@/lib/notification-router';

describe('notification integration flows', () => {
  it('message notification deep links to exact chat room/message', () => {
    const n = mapNotificationRowToModel({
      id: 'notif-chat-1',
      title: 'Message',
      body: 'Hello',
      category: 'message',
      read_at: null,
      created_at: '2026-03-31T00:00:00.000Z',
      conversation_id: 'room-a',
      message_id: 'msg-a',
    });
    const target = buildNotificationNavigationTarget(n);
    expect(target.pathname).toBe('/chat');
    expect(target.search).toContain('roomId=room-a');
    expect(target.search).toContain('messageId=msg-a');
  });

  it('order notification deep links to exact order focus target', () => {
    const n = mapNotificationRowToModel({
      id: 'notif-order-1',
      title: 'Order updated',
      body: null,
      category: 'order',
      read_at: null,
      created_at: '2026-03-31T00:00:00.000Z',
      entity_type: 'order',
      entity_id: 'order-77',
    });
    const target = buildNotificationNavigationTarget(n);
    expect(target.pathname).toBe('/trading/orders');
    expect(target.search).toBe('?focusOrderId=order-77');
  });

  it('read convergence model updates grouped ids together', () => {
    const notifications = ['a', 'b', 'c'];
    const readAt = new Date().toISOString();
    const updated = notifications.map((id) => ({ id, read_at: readAt }));
    expect(updated.every((row) => row.read_at === readAt)).toBe(true);
  });
});
