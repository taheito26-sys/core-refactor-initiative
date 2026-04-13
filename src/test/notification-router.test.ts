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

  it('uses precise target fields with tab context for deal notification', () => {
    const notification = mapNotificationRowToModel({
      id: 'n3', title: 'Deal cancelled', body: null, category: 'deal',
      read_at: null, created_at: new Date().toISOString(),
      entity_type: 'deal', entity_id: 'deal-55',
      target_path: '/trading/orders', target_tab: 'incoming',
      target_focus: 'focusDealId', target_entity_type: 'deal', target_entity_id: 'deal-55',
      actor_id: 'some-actor-uuid',
    });
    const target = buildNotificationNavigationTarget(notification);
    expect(target.pathname).toBe('/trading/orders');
    expect(target.search).toContain('tab=incoming');
    expect(target.search).toContain('focusDealId=deal-55');
    expect(isNotificationDeepLinkable(notification)).toBe(true);
  });

  it('uses precise target fields with outgoing tab', () => {
    const notification = mapNotificationRowToModel({
      id: 'n4', title: 'Deal updated', body: null, category: 'deal',
      read_at: null, created_at: new Date().toISOString(),
      target_path: '/trading/orders', target_tab: 'outgoing',
      target_focus: 'focusDealId', target_entity_type: 'deal', target_entity_id: 'deal-77',
    });
    const target = buildNotificationNavigationTarget(notification);
    expect(target.pathname).toBe('/trading/orders');
    expect(target.search).toBe('?tab=outgoing&focusDealId=deal-77');
  });

  it('falls back to legacy routing for old notifications without target fields', () => {
    const notification = mapNotificationRowToModel({
      id: 'n5', title: 'Old deal', body: null, category: 'deal',
      read_at: null, created_at: new Date().toISOString(),
      entity_type: 'deal', entity_id: 'deal-old',
    });
    const target = buildNotificationNavigationTarget(notification);
    expect(target.pathname).toBe('/trading/orders');
    expect(target.search).toBe('?focusDealId=deal-old');
    // No tab param since old notification lacks target_tab
    expect(target.search).not.toContain('tab=');
  });
});
