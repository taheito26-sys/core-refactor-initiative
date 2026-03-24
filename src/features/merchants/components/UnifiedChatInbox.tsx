import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '@/hooks/useRelationshipMessages';
import { ArrowLeft, Send, Search, MessageCircle } from 'lucide-react';

interface ConversationSummary {
  relationship_id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  unread_count: number;
}

interface Props {
  relationships: Array<{
    id: string;
    counterparty_name: string;
    counterparty_nickname: string;
    merchant_a_id: string;
    merchant_b_id: string;
  }>;
}

/* ── Avatar with initials ── */
function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name
    .split(/[\s_]+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');

  const colors = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-violet-600',
    'from-orange-500 to-red-500',
    'from-pink-500 to-rose-600',
    'from-cyan-500 to-blue-600',
  ];
  const colorIdx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

  return (
    <div
      className={`shrink-0 rounded-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center text-white font-bold shadow-md`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

/* ── Time formatting ── */
function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ── Date separator ── */
function dateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function UnifiedChatInbox({ relationships }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();

  const [activeRelId, setActiveRelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const relIds = useMemo(() => relationships.map(r => r.id), [relationships]);

  const { data: allMessages, isLoading } = useQuery({
    queryKey: ['unified-chat', relIds],
    queryFn: async () => {
      if (!relIds.length) return [];
      const { data, error } = await supabase
        .from('merchant_messages')
        .select('*')
        .in('relationship_id', relIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: relIds.length > 0,
  });

  // Realtime subscription
  useEffect(() => {
    if (!relIds.length) return;
    const channel = supabase
      .channel('unified-chat-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'merchant_messages',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [relIds, queryClient]);

  // Build conversation summaries
  const conversations: ConversationSummary[] = useMemo(() => {
    if (!allMessages || !relationships.length) return [];
    return relationships
      .map(rel => {
        const msgs = allMessages.filter(m => m.relationship_id === rel.id);
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter(m => m.sender_id !== userId && !m.read_at).length;
        return {
          relationship_id: rel.id,
          counterparty_name: rel.counterparty_name,
          counterparty_nickname: rel.counterparty_nickname,
          last_message: last?.content || '',
          last_message_at: last?.created_at || '',
          last_sender_id: last?.sender_id || '',
          unread_count: unread,
        };
      })
      .sort((a, b) => {
        if (!a.last_message_at && !b.last_message_at) return 0;
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });
  }, [allMessages, relationships, userId]);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(c =>
      c.counterparty_name.toLowerCase().includes(q) ||
      c.counterparty_nickname.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const totalUnread = useMemo(() => conversations.reduce((s, c) => s + c.unread_count, 0), [conversations]);

  // Active conversation
  const activeMessages = useMemo(() => {
    if (!activeRelId || !allMessages) return [];
    return allMessages.filter(m => m.relationship_id === activeRelId);
  }, [allMessages, activeRelId]);

  const activeRel = useMemo(() => relationships.find(r => r.id === activeRelId), [relationships, activeRelId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeMessages]);

  // Mark as read
  useEffect(() => {
    if (!activeRelId || !userId || !allMessages) return;
    const unread = allMessages.filter(m => m.relationship_id === activeRelId && m.sender_id !== userId && !m.read_at);
    if (unread.length > 0) {
      Promise.all(unread.map(m =>
        supabase.from('merchant_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id)
      )).then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
    }
  }, [activeRelId, allMessages, userId, queryClient]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || !activeRelId) return;
    try {
      await sendMessage.mutateAsync({ relationship_id: activeRelId, content: text.trim() });
      setText('');
      queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      console.error('Send failed:', err);
    }
  }, [text, activeRelId, sendMessage, queryClient]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const openChat = useCallback((relId: string) => {
    setActiveRelId(relId);
    setText('');
  }, []);

  const goBack = useCallback(() => {
    setActiveRelId(null);
    setText('');
  }, []);

  // Group messages by date
  const groupedByDate = useMemo(() => {
    const groups: { date: string; messages: typeof activeMessages }[] = [];
    for (const m of activeMessages) {
      const dateKey = new Date(m.created_at).toDateString();
      const last = groups[groups.length - 1];
      if (last && last.date === dateKey) {
        last.messages.push(m);
      } else {
        groups.push({ date: dateKey, messages: [m] });
      }
    }
    return groups;
  }, [activeMessages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     CHAT VIEW — Full-screen messenger style
     ═══════════════════════════════════════════ */
  if (activeRelId && activeRel) {
    return (
      <div className="chat-messenger-view">
        {/* ── Header ── */}
        <div className="chat-messenger-header">
          <button onClick={goBack} className="chat-back-btn">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Avatar name={activeRel.counterparty_name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">{activeRel.counterparty_name}</div>
            <div className="text-[10px] text-muted-foreground truncate">@{activeRel.counterparty_nickname}</div>
          </div>
        </div>

        {/* ── Messages ── */}
        <div ref={scrollRef} className="chat-messenger-messages">
          {activeMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-20">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle className="h-8 w-8 text-primary/40" />
              </div>
              <p className="text-sm font-medium">{t('noMessagesChat') || 'No messages yet'}</p>
              <p className="text-xs opacity-60">{t('typeMessageChat') || 'Send a message to start the conversation'}</p>
            </div>
          ) : (
            groupedByDate.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="chat-date-separator">
                  <span>{dateSeparator(group.messages[0].created_at)}</span>
                </div>
                {/* Messages in this date group */}
                {group.messages.map((m, idx) => {
                  const isOwn = m.sender_id === userId;
                  const prev = idx > 0 ? group.messages[idx - 1] : null;
                  const next = idx < group.messages.length - 1 ? group.messages[idx + 1] : null;
                  const sameSenderPrev = prev?.sender_id === m.sender_id;
                  const sameSenderNext = next?.sender_id === m.sender_id;

                  // WhatsApp-style bubble radius
                  const isFirst = !sameSenderPrev;
                  const isLast = !sameSenderNext;

                  return (
                    <div
                      key={m.id}
                      className={`chat-bubble-row ${isOwn ? 'own' : 'other'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}`}
                      style={{ marginTop: isFirst ? 8 : 1 }}
                    >
                      <div className={`chat-bubble ${isOwn ? 'own' : 'other'}`}>
                        <div className="chat-bubble-content">{m.content}</div>
                        <div className="chat-bubble-meta">
                          <span>{formatMessageTime(m.created_at)}</span>
                          {isOwn && (
                            <span className="chat-read-status">
                              {m.read_at ? (
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/><path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="currentColor"/></svg>
                              ) : (
                                <svg width="11" height="11" viewBox="0 0 16 11" fill="none"><path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/></svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* ── Input bar ── */}
        <div className="chat-messenger-input">
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={t('typeMessageChat') || 'Type a message...'}
              rows={1}
              className="chat-input-field"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={sendMessage.isPending || !text.trim()}
            className="chat-send-btn"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     CONVERSATION LIST — WhatsApp style
     ═══════════════════════════════════════════ */
  return (
    <div className="chat-inbox-view">
      {/* ── Header ── */}
      <div className="chat-inbox-header">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          💬 {t('allConversations') || 'Chats'}
          {totalUnread > 0 && (
            <span className="chat-unread-total">{totalUnread}</span>
          )}
        </h2>
      </div>

      {/* ── Search ── */}
      <div className="chat-inbox-search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('searchConversations') || 'Search conversations...'}
            className="chat-search-input"
          />
        </div>
      </div>

      {/* ── Conversation list ── */}
      <div className="chat-conversation-list">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <MessageCircle className="h-8 w-8 opacity-30" />
            </div>
            <p className="text-sm font-medium">{t('noMessagesChat') || 'No conversations yet'}</p>
            <p className="text-xs opacity-60 text-center px-8">
              {t('openRelationshipToChat') || 'Open a merchant relationship to start chatting'}
            </p>
          </div>
        ) : (
          filteredConversations.map(c => {
            const isOwnLast = c.last_sender_id === userId;
            const hasUnread = c.unread_count > 0;
            return (
              <button
                key={c.relationship_id}
                onClick={() => openChat(c.relationship_id)}
                className={`chat-conversation-item ${hasUnread ? 'unread' : ''}`}
              >
                <Avatar name={c.counterparty_name} size={50} />
                <div className="chat-conversation-info">
                  <div className="chat-conversation-top">
                    <span className="chat-conversation-name">{c.counterparty_name}</span>
                    <span className={`chat-conversation-time ${hasUnread ? 'unread' : ''}`}>
                      {c.last_message_at ? formatTime(c.last_message_at) : ''}
                    </span>
                  </div>
                  <div className="chat-conversation-bottom">
                    <span className="chat-conversation-preview">
                      {isOwnLast && <span className="chat-you-prefix">{t('you') || 'You'}: </span>}
                      {c.last_message || <span className="italic opacity-50">No messages</span>}
                    </span>
                    {hasUnread && (
                      <span className="chat-unread-badge">{c.unread_count}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
