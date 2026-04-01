import type { NavigateFunction } from 'react-router-dom';
import { useChatStore } from './chat-store';
import type { AppNotification } from '@/types/notifications';

export interface NotificationNavigationTarget {
  pathname: string;
  search?: string;
  state?: Record<string, unknown>;
  pendingChatNav?: {
    conversationId: string;
    messageId: string | null;
    notificationId: string;
  };
}

function isInternalActionUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith('/')) return true;
  try {
    const parsed = new URL(value);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function parseInternalActionUrl(value: string): NotificationNavigationTarget {
  if (value.startsWith('/')) {
    const [pathname, query] = value.split('?');
    return { pathname, search: query ? `?${query}` : undefined };
  }
  const parsed = new URL(value);
  return {
    pathname: parsed.pathname,
    search: parsed.search || undefined,
  };
}

function legacyRoute(n: AppNotification): NotificationNavigationTarget {
  switch (n.category) {
    case 'deal':
    case 'order':
      return { pathname: '/trading/orders' };
    case 'invite':
    case 'network':
      return { pathname: '/merchants' };
    case 'approval':
      return { pathname: '/admin/approvals' };
    case 'message':
      return { pathname: '/chat' };
    case 'stock':
      return { pathname: '/trading/stock' };
    default:
      return { pathname: '/dashboard' };
  }
}

/**
 * Build a precise URL from the new target_* fields stored in the notification.
 */
function buildPreciseTarget(target: AppNotification['target']): NotificationNavigationTarget | null {
  if (!target.targetPath) return null;

  const params = new URLSearchParams();

  // Add tab context
  if (target.targetTab && ['my', 'incoming', 'outgoing', 'transfers'].includes(target.targetTab)) {
    params.set('tab', target.targetTab);
  }

  // Add focus parameter using the stored focus key
  if (target.targetFocus && target.targetEntityId) {
    params.set(target.targetFocus, target.targetEntityId);
  } else if (target.targetEntityType && target.targetEntityId) {
    // Fallback: derive focus key from entity type
    const focusKeyMap: Record<string, string> = {
      deal: 'focusDealId',
      order: 'focusOrderId',
      settlement: 'focusSettlementId',
      stock: 'focusStockId',
      approval: 'focusApprovalId',
      invite: 'focusInviteId',
      transfer: 'focusTransferId',
      capital_transfer: 'focusTransferId',
    };
    const focusKey = focusKeyMap[target.targetEntityType];
    if (focusKey) {
      params.set(focusKey, target.targetEntityId);
    }
  }

  const search = params.toString();

  // Handle chat deep links with pendingChatNav
  if (target.targetPath === '/chat' && target.conversationId) {
    params.set('roomId', target.conversationId);
    if (target.messageId) params.set('messageId', target.messageId);
    return {
      pathname: '/chat',
      search: `?${params.toString()}`,
      pendingChatNav: {
        conversationId: target.conversationId,
        messageId: target.messageId ?? null,
        notificationId: target.notificationId,
      },
    };
  }

  return {
    pathname: target.targetPath,
    search: search ? `?${search}` : undefined,
  };
}

export function isNotificationDeepLinkable(notification: AppNotification): boolean {
  const { target } = notification;
  if (target.actionUrl && isInternalActionUrl(target.actionUrl)) return true;
  if (target.targetPath && (target.targetEntityId || target.targetTab)) return true;
  if (target.kind === 'chat_message') return Boolean(target.conversationId);
  // Transfer notifications
  if (target.targetEntityType === 'transfer' || target.targetEntityType === 'capital_transfer') return Boolean(target.targetEntityId);
  return Boolean(target.entityId);
}

export function buildNotificationNavigationTarget(notification: AppNotification): NotificationNavigationTarget {
  const { target } = notification;

  // Priority 1: explicit action URL
  if (target.actionUrl && isInternalActionUrl(target.actionUrl)) {
    return parseInternalActionUrl(target.actionUrl);
  }

  // Priority 2: precise stored target fields
  const precise = buildPreciseTarget(target);
  if (precise) return precise;

  // Priority 3: legacy kind-based routing (backward compat for old notifications)
  switch (target.kind) {
    case 'chat_message':
      if (!target.conversationId) {
        console.warn('[notification-router] Chat notification missing conversationId, cannot deep-link:', notification.id);
        return { pathname: '/chat' };
      }
      return {
        pathname: '/chat',
        search: `?roomId=${encodeURIComponent(target.conversationId)}${target.messageId ? `&messageId=${encodeURIComponent(target.messageId)}` : ''}`,
        pendingChatNav: {
          conversationId: target.conversationId,
          messageId: target.messageId ?? null,
          notificationId: notification.id,
        },
      };
    case 'order':
      return { pathname: '/trading/orders', search: target.entityId ? `?focusOrderId=${encodeURIComponent(target.entityId)}` : undefined };
    case 'deal':
      return { pathname: '/trading/orders', search: target.entityId ? `?focusDealId=${encodeURIComponent(target.entityId)}` : undefined };
    case 'settlement':
      return { pathname: '/trading/orders', search: target.entityId ? `?focusSettlementId=${encodeURIComponent(target.entityId)}` : undefined };
    case 'stock':
      return { pathname: '/trading/stock', search: target.entityId ? `?focusStockId=${encodeURIComponent(target.entityId)}` : undefined };
    case 'approval':
      return { pathname: '/admin/approvals', search: target.entityId ? `?focusApprovalId=${encodeURIComponent(target.entityId)}` : undefined };
    case 'invite':
      return { pathname: '/merchants', search: target.entityId ? `?focusInviteId=${encodeURIComponent(target.entityId)}` : undefined };
    default:
      return legacyRoute(notification);
  }
}

export function handleNotificationClick(notification: AppNotification, navigate: NavigateFunction): void {
  const navTarget = buildNotificationNavigationTarget(notification);

  if (navTarget.pendingChatNav) {
    useChatStore.getState().setPendingNav(navTarget.pendingChatNav);
  }

  navigate({
    pathname: navTarget.pathname,
    search: navTarget.search,
  }, { state: navTarget.state });
}
