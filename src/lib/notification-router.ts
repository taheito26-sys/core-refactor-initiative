/* ═══════════════════════════════════════════════════════════════
   Notification Router — deep-link any notification to its exact target
   ═══════════════════════════════════════════════════════════════ */

import type { NavigateFunction } from 'react-router-dom';
import { useChatStore } from './chat-store';

export interface EnrichedNotification {
  id: string;
  title: string;
  body: string | null;
  category: string;
  read_at: string | null;
  created_at: string;
  // Routing metadata (may be null for legacy notifications)
  conversation_id?: string | null;
  message_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  anchor_id?: string | null;
}

/** Legacy route fallback for notifications without routing metadata */
function legacyRoute(n: EnrichedNotification): string {
  switch (n.category) {
    case 'deal':
    case 'order':
      return '/trading/orders';
    case 'invite':
    case 'network':
      return '/merchants';
    case 'approval':
      return '/admin/approvals';
    case 'merchant':
      return '/merchants';
    case 'message':
      return '/chat';
    default:
      return '/dashboard';
  }
}

/** Entity-type to route mapping */
function entityRoute(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'order':
      return `/trading/orders`;
    case 'deal':
      return `/trading/orders`;
    case 'stock':
      return `/trading/stock`;
    case 'settlement':
      return `/trading/orders`;
    case 'approval':
      return `/admin/approvals`;
    default:
      return '/dashboard';
  }
}

/**
 * Handle notification click — navigate to the exact location.
 *
 * For chat notifications: opens /chat, sets active conversation,
 * scrolls to exact message, highlights it.
 *
 * For entity notifications: navigates to the correct tracker module.
 */
export function handleNotificationClick(
  notification: EnrichedNotification,
  navigate: NavigateFunction,
): void {
  const store = useChatStore.getState();

  // ── Chat message notification with conversation deep link ──────
  if (notification.category === 'message' && notification.conversation_id) {
    store.setActiveConversation(notification.conversation_id);

    if (notification.message_id) {
      store.setAnchor(notification.message_id);
    }

    navigate('/chat');
    return;
  }

  // ── Entity notification with routing metadata ──────────────────
  if (notification.entity_type && notification.entity_id) {
    const route = entityRoute(notification.entity_type, notification.entity_id);
    navigate(route);
    return;
  }

  // ── Legacy fallback ────────────────────────────────────────────
  navigate(legacyRoute(notification));
}

/**
 * Determine the route string for a notification (used in link previews).
 * Does NOT navigate or modify state — pure function.
 */
export function getNotificationRoute(n: EnrichedNotification): string {
  if (n.category === 'message' && n.conversation_id) return '/chat';
  if (n.entity_type && n.entity_id) return entityRoute(n.entity_type, n.entity_id);
  return legacyRoute(n);
}
