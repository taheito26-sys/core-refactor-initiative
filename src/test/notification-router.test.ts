import { describe, expect, it } from 'vitest';
import { buildNotificationNavigationTarget, isNotificationDeepLinkable } from '@/lib/notification-router';
import { mapNotificationRowToModel } from '@/types/notifications';

describe('notification router', () => {
  it('builds chat deep link with pending nav', () => {
    const notification = mapNotificationRowToModel({
      id: 'n1',
      title: 'msg',
      body: null,
      category: 'message',
      read_at: null,
      created_at: new Date().toISOString(),
      conversation_id: 'room-1',
      message_id: 'msg-9',
    });
    const target = buildNotificationNavigationTarget(notification);
    expect(target.pathname).toBe('/chat');
    expect(target.search).toContain('roomId=room-1');
    expect(target.pendingChatNav?.messageId).toBe('msg-9');
    expect(isNotificationDeepLinkable(notification)).toBe(true);
  });

  it('builds order deep link with focus param', () => {
    const notification = mapNotificationRowToModel({
      id: 'n2', title: 'order', body: null, category: 'order', read_at: null, created_at: new Date().toISOString(), entity_type: 'order', entity_id: 'ord-44',
    });
    const target = buildNotificationNavigationTarget(notification);
    expect(target.pathname).toBe('/trading/orders');
    expect(target.search).toBe('?focusOrderId=ord-44');
  });
});
