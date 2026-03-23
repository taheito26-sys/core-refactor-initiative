import { useState, useRef, useEffect, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '@/hooks/useRelationshipMessages';
import '@/styles/tracker.css';

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

export function UnifiedChatInbox({ relationships }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();

  const [activeRelId, setActiveRelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch all messages for all relationships
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
    const relMap = new Map(relationships.map(r => [r.id, r]));

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
          last_message_at: last?.created_at || rel.id,
          last_sender_id: last?.sender_id || '',
          unread_count: unread,
        };
      })
      .filter(c => c.last_message) // only show conversations with messages
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  }, [allMessages, relationships, userId]);

  const totalUnread = useMemo(() => conversations.reduce((s, c) => s + c.unread_count, 0), [conversations]);

  // Active conversation messages
  const activeMessages = useMemo(() => {
    if (!activeRelId || !allMessages) return [];
    return allMessages.filter(m => m.relationship_id === activeRelId);
  }, [allMessages, activeRelId]);

  const activeRel = useMemo(() => relationships.find(r => r.id === activeRelId), [relationships, activeRelId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages]);

  // Mark as read when opening conversation
  useEffect(() => {
    if (!activeRelId || !userId || !allMessages) return;
    const unread = allMessages.filter(m => m.relationship_id === activeRelId && m.sender_id !== userId && !m.read_at);
    if (unread.length > 0) {
      Promise.all(unread.map(m =>
        supabase.from('merchant_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id)
      )).then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
    }
  }, [activeRelId, allMessages, userId, queryClient]);

  const handleSend = async () => {
    if (!text.trim() || !activeRelId) return;
    try {
      await sendMessage.mutateAsync({ relationship_id: activeRelId, content: text.trim() });
      setText('');
      queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  if (isLoading) {
    return <div className="empty"><div className="empty-t">{t('loading') || '...'}</div></div>;
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 450, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Conversation list */}
      <div style={{
        width: activeRelId ? 260 : '100%',
        borderRight: activeRelId ? '1px solid var(--line)' : 'none',
        overflowY: 'auto',
        background: 'var(--cardBg)',
        transition: 'width 0.2s',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700 }}>
          💬 {t('allConversations') || 'All Conversations'}
          {totalUnread > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, background: 'var(--bad)', color: '#fff',
              borderRadius: 10, padding: '1px 6px', marginLeft: 6,
            }}>{totalUnread}</span>
          )}
        </div>

        {conversations.length === 0 ? (
          <div className="empty" style={{ padding: 20 }}>
            <div className="empty-t">{t('noMessagesChat') || 'No conversations yet'}</div>
            <div className="empty-s" style={{ fontSize: 9 }}>
              {t('openRelationshipToChat') || 'Open a relationship and start chatting'}
            </div>
          </div>
        ) : (
          conversations.map(c => {
            const isActive = c.relationship_id === activeRelId;
            const isOwnLast = c.last_sender_id === userId;
            return (
              <button
                key={c.relationship_id}
                onClick={() => setActiveRelId(c.relationship_id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 2,
                  width: '100%', textAlign: 'left', padding: '10px 12px',
                  background: isActive ? 'var(--brand3)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                  border: 'none', borderBottomStyle: 'solid',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{c.counterparty_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {c.unread_count > 0 && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, background: 'var(--brand)', color: '#fff',
                        borderRadius: 10, padding: '1px 6px', minWidth: 16, textAlign: 'center',
                      }}>{c.unread_count}</span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>
                      {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isOwnLast ? `${t('you') || 'You'}: ` : ''}{c.last_message}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Chat area */}
      {activeRelId && activeRel && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
          {/* Chat header */}
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{activeRel.counterparty_name}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>@{activeRel.counterparty_nickname}</div>
            </div>
            <button className="rowBtn" onClick={() => setActiveRelId(null)} style={{ fontSize: 10 }}>✕</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeMessages.length === 0 ? (
              <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="empty-t">{t('noMessagesChat') || 'No messages yet'}</div>
              </div>
            ) : (
              activeMessages.map(m => {
                const isOwn = m.sender_id === userId;
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                    <div style={{
                      maxWidth: '75%', padding: '8px 12px', borderRadius: 12,
                      background: isOwn ? 'var(--brand3)' : 'var(--panel2)',
                      border: isOwn ? '1px solid var(--brand)' : '1px solid var(--line)',
                      fontSize: 11,
                    }}>
                      <div>{m.content}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, textAlign: isOwn ? 'right' : 'left' }}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {m.read_at && ' ✓✓'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid var(--line)' }}>
            <div className="inputBox" style={{ flex: 1, padding: '6px 10px' }}>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={t('typeMessageChat') || 'Type a message...'}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
            </div>
            <button className="btn" onClick={handleSend} disabled={sendMessage.isPending || !text.trim()}>
              {t('sendMessageBtn') || 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
