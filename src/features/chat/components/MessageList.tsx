import { useMemo } from 'react';
import { BusinessObjectCard } from '@/features/chat/components/BusinessObjectCard';
import { MessageItem } from '@/features/chat/components/MessageItem';
import { UnreadDivider } from '@/features/chat/components/UnreadDivider';
import type { TimelineItem, ChatBusinessObject } from '@/features/chat/lib/types';

interface Props {
  messages: TimelineItem[];
  currentUserId: string;
  unreadMessageId: string | null;
  reactionsByMessage: Record<string, string[]>;
  pinnedSet: Set<string>;
  onReact: (messageId: string, emoji: string, remove?: boolean) => void;
  onPinToggle: (messageId: string, pinned: boolean) => void;
  onMarkRead: (messageId: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onDeleteForEveryone: (messageId: string) => void;
  onCreateOrder: (messageId: string) => void;
  onCreateTask: (messageId: string) => void;
  onAcceptDeal?: (id: string) => void;
  onConvert?: (messageId: string, type: 'task' | 'order') => void;
  onReply?: (message: any) => void;
  disableForward?: boolean;
}

export function MessageList(props: Props) {
  const unreadCount = useMemo(() => {
    if (!props.unreadMessageId) return 0;
    const idx = props.messages.findIndex((m) => m.id === props.unreadMessageId);
    if (idx === -1) return 0;
    return props.messages.length - idx;
  }, [props.messages, props.unreadMessageId]);

  return (
    <div className="flex-1 overflow-auto py-2">
      {props.messages.map((m) => {
        if (m.type === 'business_object') {
          return (
            <BusinessObjectCard 
              key={m.id} 
              obj={m as ChatBusinessObject} 
              onAccept={() => props.onAcceptDeal?.(m.id)}
            />
          );
        }

        const showUnread = props.unreadMessageId === m.id;
        const msg = m as any;
        return (
          <div key={m.id} id={`msg-${m.id}`}>
            {showUnread && unreadCount > 0 && <UnreadDivider count={unreadCount} />}
            <MessageItem
              message={{ id: msg.id, content: msg.content || msg.body || '', sender_id: msg.sender_id, created_at: msg.created_at, type: msg.message_type, status: msg.status, expires_at: msg.expires_at }}
              currentUserId={props.currentUserId}
            />
          </div>
        );
      })}
    </div>
  );
}
