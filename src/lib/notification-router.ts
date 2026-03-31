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

export function isNotificationDeepLinkable(notification: AppNotification): boolean {
  const { target } = notification;
  if (target.actionUrl && isInternalActionUrl(target.actionUrl)) return true;
  if (target.kind === 'chat_message') return Boolean(target.conversationId);
  return Boolean(target.entityId);
}

export function buildNotificationNavigationTarget(notification: AppNotification): NotificationNavigationTarget {
  const { target } = notification;

  if (target.actionUrl && isInternalActionUrl(target.actionUrl)) {
    return parseInternalActionUrl(target.actionUrl);
  }

  switch (target.kind) {
    case 'chat_message':
      if (!target.conversationId) return { pathname: '/chat' };
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
