/* ═══════════════════════════════════════════════════════════════
   MessageTimeline — scrollable message list with anchor navigation,
   unread dividers, sticky date separators, and jump-to-latest
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useChatStore } from '@/lib/chat-store';
import type { ChatMessage } from '@/lib/chat-store';
import { groupMessagesByDate, fmtDateSeparator } from '../lib/message-codec';
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
}

export function MessageTimeline({
  messages, currentUserId, counterpartyName, scrollRef, onReply,
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

  // ── Compute first unread message (snapshot on mount) ───────────
  const firstUnreadId = useMemo(() => {
    for (const m of messages) {
      if (m.sender_id !== currentUserId && !m.read_at) return m.id;
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]); // Only recompute when conversation changes, not on every message

  const unreadCount = useMemo(
    () => messages.filter((m) => m.sender_id !== currentUserId && !m.read_at).length,
    [messages, currentUserId]
  );

  // ── Group messages by date ─────────────────────────────────────
  const groups = useMemo(() => groupMessagesByDate(messages), [messages]);

  // ── Scroll tracking ────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setIsAtBottom(nearBottom);
  }, []);

  // Combined ref: internal + external (for attention tracking)
  const setCombinedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      scrollRef(el);
    },
    [scrollRef]
  );

  // ── Auto-scroll to bottom on new messages if already at bottom ─
  useEffect(() => {
    if (isAtBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length, isAtBottom]);

  // ── Scroll to bottom on conversation change ────────────────────
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }, [activeConvId]);

  // ── Anchor scroll + highlight ──────────────────────────────────
  useEffect(() => {
    if (!anchorId) return;

    const attempt = () => {
      const el = containerRef.current?.querySelector(`[data-msg-id="${anchorId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight clears after 2s
        setTimeout(() => clearHighlight(), 2000);
        setAnchor(null); // consumed
        return true;
      }
      return false;
    };

    // Try immediately, retry once after a short delay (messages may still be loading)
    if (!attempt()) {
      const timer = setTimeout(attempt, 300);
      return () => clearTimeout(timer);
    }
  }, [anchorId, clearHighlight, setAnchor]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  const scrollToMessage = (id: string) => {
    const el = containerRef.current?.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Briefly highlight
      useChatStore.getState().setAnchor(id);
      setTimeout(() => useChatStore.getState().clearHighlight(), 2000);
    }
  };

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
      {/* Scrollable message area */}
      <div
        ref={setCombinedRef}
        onScroll={handleScroll}
        style={{
          height: '100%', overflowY: 'auto', overflowX: 'hidden',
          padding: '8px 0',
        }}
      >
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--muted)', fontSize: 12,
          }}>
            No messages yet. Say hello!
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              {/* Sticky date separator */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                display: 'flex', justifyContent: 'center', padding: '8px 0',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--muted)',
                  background: 'var(--panel)', padding: '3px 12px',
                  borderRadius: 10, border: '1px solid var(--line)',
                }}>
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
                      message={msg}
                      isOwn={isOwn}
                      isFirstInGroup={isFirst}
                      isLastInGroup={isLast}
                      currentUserId={currentUserId}
                      counterpartyName={counterpartyName}
                      isHighlighted={highlightId === msg.id}
                      onReply={onReply}
                      onScrollToMessage={scrollToMessage}
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/* Typing indicator */}
        <TypingIndicator users={typing} />
      </div>

      {/* Jump to latest button */}
      {!isAtBottom && (
        <JumpToLatestButton unreadCount={unreadCount} onClick={scrollToBottom} />
      )}

      {/* Highlight CSS */}
      <style>{`
        .msg-highlight {
          background: color-mix(in srgb, var(--brand) 18%, transparent) !important;
          transition: background 2s ease-out;
        }
      `}</style>
    </div>
  );
}
