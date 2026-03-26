/* ═══════════════════════════════════════════════════════════════
   ChatPage — three-column Rocket.Chat-style workspace
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '@/hooks/useRelationshipMessages';
import { useChatStore } from '@/lib/chat-store';
import type { ConversationSummary, ChatMessage } from '@/lib/chat-store';
import { useChatAttention } from '@/hooks/useChatAttention';
import { useChatRealtime } from '@/hooks/useChatRealtime';

import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageTimeline } from '@/features/chat/components/MessageTimeline';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { ContextPanel } from '@/features/chat/components/ContextPanel';

import '@/styles/tracker.css';

interface Relationship {
  id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code?: string;
  merchant_a_id: string;
  merchant_b_id: string;
}

export default function ChatPage() {
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();
  const isRTL = settings.language === 'ar';

  // ── Chat store state ──────────────────────────────────────────
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setUnreadCounts = useChatStore((s) => s.setUnreadCounts);
  const markConversationRead = useChatStore((s) => s.markConversationRead);
  const consumePendingNav = useChatStore((s) => s.consumePendingNav);
  const setAnchor = useChatStore((s) => s.setAnchor);

  // ── Reply state ───────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; preview: string } | null>(null);
  const [showMsgSearch, setShowMsgSearch] = useState(false);

  // ── Load relationships ────────────────────────────────────────
  const myId = merchantProfile?.merchant_id;

  const { data: relationships = [], isLoading } = useQuery({
    queryKey: ['chat-relationships', myId],
    queryFn: async (): Promise<Relationship[]> => {
      const [relsRes, profilesRes] = await Promise.all([
        supabase.from('merchant_relationships').select('*').order('created_at', { ascending: false }),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);
      const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.merchant_id, p]));
      return (relsRes.data || []).map((r: any) => {
        const cpId = r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id;
        const cp = profileMap.get(cpId) as any;
        return {
          ...r,
          counterparty_name: cp?.display_name || cpId,
          counterparty_nickname: cp?.nickname || '',
          counterparty_code: cp?.merchant_code || '',
        };
      });
    },
    enabled: !!myId,
    staleTime: 30_000,
  });

  const relationshipIds = useMemo(() => relationships.map((r) => r.id), [relationships]);

  // ── Load all messages ─────────────────────────────────────────
  const { data: allMessages = [] } = useQuery({
    queryKey: ['unified-chat', relationshipIds],
    queryFn: async (): Promise<ChatMessage[]> => {
      if (relationshipIds.length === 0) return [];
      const { data, error } = await supabase
        .from('merchant_messages')
        .select('id, relationship_id, sender_id, content, read_at, created_at')
        .in('relationship_id', relationshipIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ChatMessage[];
    },
    enabled: relationshipIds.length > 0,
    staleTime: 10_000,
  });

  // ── Build conversation summaries ──────────────────────────────
  const conversations: ConversationSummary[] = useMemo(() => {
    const map = new Map<string, ConversationSummary>();

    for (const rel of relationships) {
      map.set(rel.id, {
        relationship_id: rel.id,
        counterparty_name: rel.counterparty_name,
        counterparty_nickname: rel.counterparty_nickname,
        last_message: '',
        last_message_at: '',
        last_sender_id: '',
        unread_count: 0,
        is_muted: false,
        is_pinned: false,
      });
    }

    for (const msg of allMessages) {
      const conv = map.get(msg.relationship_id);
      if (!conv) continue;
      // Last message
      if (!conv.last_message_at || msg.created_at > conv.last_message_at) {
        conv.last_message = msg.content;
        conv.last_message_at = msg.created_at;
        conv.last_sender_id = msg.sender_id;
      }
      // Unread count (messages from others without read_at)
      if (msg.sender_id !== userId && !msg.read_at) {
        conv.unread_count++;
      }
    }

    // Sort by latest message
    return Array.from(map.values()).sort(
      (a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || '')
    );
  }, [allMessages, relationships, userId]);

  // Sync unread counts from RPC to the store
  useEffect(() => {
    if (!userId) return;
    supabase.rpc('get_unread_counts').then(({ data }) => {
      if (!data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { relationship_id: string; unread_count: number }[]) {
        counts[row.relationship_id] = row.unread_count;
      }
      setUnreadCounts(counts);
    });
  }, [userId, allMessages, setUnreadCounts]);

  // ── Consume pending notification deep-link ──────────────────
  useEffect(() => {
    if (isLoading || !relationships.length) return;
    const nav = consumePendingNav();
    if (!nav) return;

    // Activate the target conversation
    setActiveConversation(nav.conversationId);

    // Schedule anchor after conversation messages render
    if (nav.messageId) {
      requestAnimationFrame(() => setAnchor(nav.messageId));
    }
  }, [isLoading, relationships, consumePendingNav, setActiveConversation, setAnchor]);

  // ── Attention tracking ────────────────────────────────────────
  const { setScrollRef } = useChatAttention();

  // ── Realtime ──────────────────────────────────────────────────
  const { signalTyping } = useChatRealtime({ relationshipIds });

  // ── Mark active conversation as read (via RPC) ─────────────────
  useEffect(() => {
    if (!activeConversationId || !userId) return;
    const hasUnread = allMessages.some(
      (m) => m.relationship_id === activeConversationId && m.sender_id !== userId && !m.read_at
    );
    if (!hasUnread) return;

    supabase.rpc('mark_conversation_read', { _relationship_id: activeConversationId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      });

    // Update store
    const lastMsg = [...allMessages]
      .filter((m) => m.relationship_id === activeConversationId)
      .pop();
    if (lastMsg) markConversationRead(activeConversationId, lastMsg.id);
  }, [activeConversationId, allMessages, userId, queryClient, markConversationRead]);

  // ── Active conversation data ──────────────────────────────────
  const activeRel = useMemo(
    () => relationships.find((r) => r.id === activeConversationId) || null,
    [relationships, activeConversationId]
  );

  const activeMessages = useMemo(
    () => allMessages.filter((m) => m.relationship_id === activeConversationId),
    [allMessages, activeConversationId]
  );

  // ── Send message ──────────────────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!activeConversationId || !userId) return;
      sendMessage.mutateAsync({
        relationship_id: activeConversationId,
        content,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      });
    },
    [activeConversationId, userId, sendMessage, queryClient]
  );

  const handleReply = useCallback(
    (msg: ChatMessage) => {
      const preview = msg.content.startsWith('||VOICE||') ? '🎤 Voice message' : msg.content.slice(0, 80);
      setReplyTo({
        id: msg.id,
        sender: msg.sender_id === userId ? 'You' : (activeRel?.counterparty_nickname || activeRel?.counterparty_name || ''),
        preview,
      });
    },
    [userId, activeRel]
  );

  // ── Loading ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {/* LEFT — Conversation Sidebar */}
      <ConversationSidebar
        conversations={conversations}
        currentUserId={userId || ''}
      />

      {/* CENTER — Active Conversation */}
      {activeConversationId && activeRel ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          height: '100%', overflow: 'hidden', minWidth: 0,
        }}>
          {/* Sticky header */}
          <ConversationHeader
            name={activeRel.counterparty_name}
            nickname={activeRel.counterparty_nickname}
            onBack={() => setActiveConversation(null)}
            onSearchToggle={() => setShowMsgSearch((v) => !v)}
          />

          {/* Scrollable message timeline */}
          <MessageTimeline
            messages={activeMessages}
            currentUserId={userId || ''}
            counterpartyName={activeRel.counterparty_name}
            scrollRef={setScrollRef}
            onReply={handleReply}
          />

          {/* Pinned composer — flex-shrink: 0 means it never collapses */}
          <MessageComposer
            onSend={handleSend}
            onTyping={signalTyping}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: 13,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Select a conversation</div>
            <div style={{ fontSize: 11 }}>Choose a conversation from the left to start messaging</div>
          </div>
        </div>
      )}

      {/* RIGHT — Context Panel (hidden on mobile / when no conversation) */}
      {activeConversationId && (
        <ContextPanel relationship={activeRel} />
      )}
    </div>
  );
}
