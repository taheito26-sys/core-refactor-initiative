import { useEffect, useMemo, useRef } from 'react';
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
  const lastReadMutationRef = useRef<string | null>(null);
  const unreadCount = useMemo(() => {
    if (!props.unreadMessageId) return 0;
    const idx = props.messages.findIndex((m) => m.id === props.unreadMessageId);
    if (idx === -1) return 0;
    return props.messages.length - idx;
  }, [props.messages, props.unreadMessageId]);

  useEffect(() => {
    const candidate = [...props.messages]
      .reverse()
      .find((m: any) => {
        const senderId = m.sender_id || m.sender_merchant_id;
        return senderId !== props.currentUserId && !m.read_at;
      }) as any;
    if (!candidate) return;
    if (lastReadMutationRef.current === candidate.id) return;

    const element = document.getElementById(`msg-${candidate.id}`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const visible = rect.top < window.innerHeight && rect.bottom > 0;
    if (!visible) return;

    const timer = window.setTimeout(() => {
      lastReadMutationRef.current = candidate.id;
      props.onMarkRead(candidate.id);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [props.messages, props.currentUserId, props.onMarkRead]);

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
              message={{ id: msg.id, content: msg.content || msg.body || '', sender_id: msg.sender_id || msg.sender_merchant_id || '', created_at: msg.created_at, type: msg.message_type, status: msg.status, expires_at: msg.expires_at, metadata: msg.metadata }}
              currentUserId={props.currentUserId}
            />
          </div>
        );
      })}
    </div>
  );
}
