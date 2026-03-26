import { useMemo } from 'react';
import type { ChatMessage } from '@/features/chat/lib/types';
import { MessageItem } from '@/features/chat/components/MessageItem';
import { UnreadDivider } from '@/features/chat/components/UnreadDivider';

interface Props {
  messages: ChatMessage[];
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
        const showUnread = props.unreadMessageId === m.id;
        return (
          <div key={m.id} id={`msg-${m.id}`}>
            {showUnread && unreadCount > 0 && <UnreadDivider count={unreadCount} />}
            <MessageItem
              message={m}
              isOwn={m.sender_id === props.currentUserId}
              reactions={props.reactionsByMessage[m.id] ?? []}
              pinned={props.pinnedSet.has(m.id)}
              onReact={(emoji, remove) => props.onReact(m.id, emoji, remove)}
              onPinToggle={() => props.onPinToggle(m.id, props.pinnedSet.has(m.id))}
              onMarkRead={() => props.onMarkRead(m.id)}
              onDeleteForMe={() => props.onDeleteForMe(m.id)}
              onDeleteForEveryone={() => props.onDeleteForEveryone(m.id)}
              onCreateOrder={() => props.onCreateOrder(m.id)}
              onCreateTask={() => props.onCreateTask(m.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
