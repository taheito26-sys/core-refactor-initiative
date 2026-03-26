/**
 * Notification routing with deep-link support.
 * Notifications carry category + metadata to enable exact navigation.
 */
import type { Notification } from '@/hooks/useNotifications';

export interface NotificationRouteResult {
  path: string;
  /** If this is a chat notification, the conversation (relationship) ID */
  conversationId?: string;
  /** If this is a chat notification, the triggering message ID */
  messageId?: string;
}

/**
 * Extract deep-link metadata from a notification.
 * Chat notifications from the DB trigger include sender info in the title
 * and the message preview in the body. We extract conversation routing from these.
 */
export function resolveNotificationRoute(n: Notification): NotificationRouteResult {
  switch (n.category) {
    case 'message':
      // Chat message notifications — route to /chat with conversation deep-link
      // The notification body contains the message preview
      // We need to extract relationship_id from notification metadata
      return {
        path: '/chat',
        // Note: conversation_id will be resolved by matching sender name in chat
      };

    case 'deal':
    case 'order':
      return { path: '/trading/orders' };

    case 'invite':
    case 'network':
      return { path: '/merchants' };

    case 'approval':
      return { path: '/admin/approvals' };

    case 'merchant':
      return { path: '/merchants' };

    default:
      return { path: '/dashboard' };
  }
}

/**
 * Extract sender name from notification title patterns:
 * - "New message from X"
 * - "X sent you a message"  
 * - "X sent you a new deal"
 */
export function extractSenderFromTitle(title: string): string | null {
  const fromMatch = title.match(/from\s+(.+)$/i);
  if (fromMatch) return fromMatch[1].trim();
  const sentMatch = title.match(/^(.+?)\s+sent\s+you/i);
  if (sentMatch) return sentMatch[1].trim();
  return null;
}
