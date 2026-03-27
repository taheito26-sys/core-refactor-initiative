/* ═══════════════════════════════════════════════════════════════
   MessageTimeline — scrollable message list with date separators,
   unread dividers, anchor navigation, jump-to-latest
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useChatStore } from '@/lib/chat-store';
import type { ChatMessage } from '@/lib/chat-store';
import { groupMessagesByDate } from '../lib/message-codec';
import { MessageItem } from './MessageItem';
import { UnreadDivider } from './UnreadDivider';
import { JumpToLatestButton } from './JumpToLatestButton';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  messages: ChatMessage[];
  currentUserId: string;
  counterpartyName: string;
  scrollRef: (el: HTMLDivElement | null) => void;
  onReply: (msg: ChatMessage) => void;
  onForward?: (msg: ChatMessage) => void;
  relationshipId?: string;
}

export function MessageTimeline({
  messages, currentUserId, counterpartyName, scrollRef, onReply, onForward, relationshipId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const highlightId = useChatStore((s) => s.highlightMessageId);
  const anchorId = useChatStore((s) => s.activeMessageAnchor);
  const clearHighlight = useChatStore((s) => s.clearHighlight);
  const setAnchor = useChatStore((s) => s.setAnchor);
  const activeConvId = useChatStore((s) => s.activeConversationId);
  const typingUsers = useChatStore((s) => {
    const id = s.activeConversationId;
    if (!id) return undefined;
    return s.typingByConversation[id];
  });
  const typing = typingUsers ?? [];

  const firstUnreadId = useMemo(() => {
    for (const m of messages) {
      if (m.sender_id !== currentUserId && !m.read_at) return m.id;
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  const unreadCount = useMemo(
    () => messages.filter((m) => m.sender_id !== currentUserId && !m.read_at).length,
    [messages, currentUserId]
  );

  const groups = useMemo(() => groupMessagesByDate(messages), [messages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, []);

  const setCombinedRef = useCallback(
    (el: HTMLDivElement | null) => { containerRef.current = el; scrollRef(el); },
    [scrollRef]
  );

  useEffect(() => {
    if (isAtBottom && containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    if (containerRef.current) { containerRef.current.scrollTop = containerRef.current.scrollHeight; setIsAtBottom(true); }
  }, [activeConvId]);

  useEffect(() => {
    if (!anchorId) return;
    const attempt = () => {
      const el = containerRef.current?.querySelector(`[data-msg-id="${anchorId}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => clearHighlight(), 2000); setAnchor(null); return true; }
      return false;
    };
    if (!attempt()) { const timer = setTimeout(attempt, 300); return () => clearTimeout(timer); }
  }, [anchorId, clearHighlight, setAnchor]);

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  };

  const scrollToMessage = (id: string) => {
    const el = containerRef.current?.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      useChatStore.getState().setAnchor(id);
      setTimeout(() => useChatStore.getState().clearHighlight(), 2000);
    }
  };

  return (
    <div className="flex-1 relative min-h-0 overflow-hidden bg-background">
      <div
        ref={setCombinedRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overflow-x-hidden py-2"
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            No messages yet. Say hello!
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              {/* Sticky date separator */}
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="text-[10px] font-bold text-muted-foreground bg-card px-3 py-0.5 rounded-full border border-border">
                  {group.label}
                </span>
              </div>

              {group.messages.map((msg, idx) => {
                const prev = group.messages[idx - 1];
                const next = group.messages[idx + 1];
                const isOwn = msg.sender_id === currentUserId;
                const isFirst = !prev || prev.sender_id !== msg.sender_id;
                const isLast = !next || next.sender_id !== msg.sender_id;
                const showUnreadDivider = msg.id === firstUnreadId;

                return (
                  <div key={msg.id}>
                    {showUnreadDivider && <UnreadDivider count={unreadCount} />}
                    <MessageItem
                      message={{ id: msg.id, content: msg.content, sender_id: msg.sender_id, created_at: msg.created_at, type: (msg as any).msg_type, status: (msg as any).status, expires_at: (msg as any).expires_at }}
                      currentUserId={currentUserId}
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}
        <TypingIndicator users={typing} />
      </div>

      {!isAtBottom && <JumpToLatestButton unreadCount={unreadCount} onClick={scrollToBottom} />}

      <style>{`
        .msg-highlight {
          background: hsl(var(--primary) / 0.12) !important;
          transition: background 2s ease-out;
        }
      `}</style>
    </div>
  );
}
