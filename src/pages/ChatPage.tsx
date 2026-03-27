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
import { encodeForward, parseMsg, getPalette } from '@/features/chat/lib/message-codec';
import { Forward, X } from 'lucide-react';

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

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setUnreadCounts = useChatStore((s) => s.setUnreadCounts);
  const markConversationRead = useChatStore((s) => s.markConversationRead);
  const consumePendingNav = useChatStore((s) => s.consumePendingNav);
  const setAnchor = useChatStore((s) => s.setAnchor);

  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; preview: string } | null>(null);
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);

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
        return { ...r, counterparty_name: cp?.display_name || cpId, counterparty_nickname: cp?.nickname || '', counterparty_code: cp?.merchant_code || '' };
      });
    },
    enabled: !!myId,
    staleTime: 30_000,
  });

  const relationshipIds = useMemo(() => relationships.map((r) => r.id), [relationships]);

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

  const conversations: ConversationSummary[] = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const rel of relationships) {
      map.set(rel.id, { relationship_id: rel.id, counterparty_name: rel.counterparty_name, counterparty_nickname: rel.counterparty_nickname, last_message: '', last_message_at: '', last_sender_id: '', unread_count: 0, is_muted: false, is_pinned: false });
    }
    for (const msg of allMessages) {
      const conv = map.get(msg.relationship_id);
      if (!conv) continue;
      if (!conv.last_message_at || msg.created_at > conv.last_message_at) { conv.last_message = msg.content; conv.last_message_at = msg.created_at; conv.last_sender_id = msg.sender_id; }
      if (msg.sender_id !== userId && !msg.read_at) conv.unread_count++;
    }
    return Array.from(map.values()).sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
  }, [allMessages, relationships, userId]);

  useEffect(() => {
    if (!userId) return;
    supabase.rpc('get_unread_counts').then(({ data }) => {
      if (!data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { relationship_id: string; unread_count: number }[]) counts[row.relationship_id] = row.unread_count;
      setUnreadCounts(counts);
    });
  }, [userId, allMessages, setUnreadCounts]);

  useEffect(() => {
    if (isLoading || !relationships.length) return;
    const nav = consumePendingNav();
    if (!nav) return;
    setActiveConversation(nav.conversationId);
    if (nav.messageId) requestAnimationFrame(() => setAnchor(nav.messageId));
  }, [isLoading, relationships, consumePendingNav, setActiveConversation, setAnchor]);

  const { setScrollRef } = useChatAttention();
  const { signalTyping } = useChatRealtime({ relationshipIds });

  useEffect(() => {
    if (!activeConversationId || !userId) return;
    const hasUnread = allMessages.some((m) => m.relationship_id === activeConversationId && m.sender_id !== userId && !m.read_at);
    if (!hasUnread) return;
    supabase.rpc('mark_conversation_read', { _relationship_id: activeConversationId }).then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
    const lastMsg = [...allMessages].filter((m) => m.relationship_id === activeConversationId).pop();
    if (lastMsg) markConversationRead(activeConversationId, lastMsg.id);
  }, [activeConversationId, allMessages, userId, queryClient, markConversationRead]);

  const activeRel = useMemo(() => relationships.find((r) => r.id === activeConversationId) || null, [relationships, activeConversationId]);
  const activeMessages = useMemo(() => allMessages.filter((m) => m.relationship_id === activeConversationId), [allMessages, activeConversationId]);

  const handleSend = useCallback((payload: { content: string; type: string; expiresAt?: string }) => {
    if (!activeConversationId || !userId) return;
    sendMessage.mutateAsync({ relationship_id: activeConversationId, content: payload.content }).then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
  }, [activeConversationId, userId, sendMessage, queryClient]);

  const handleReply = useCallback((msg: ChatMessage) => {
    const preview = msg.content.startsWith('||VOICE||') ? '🎤 Voice message' : msg.content.slice(0, 80);
    setReplyTo({ id: msg.id, sender: msg.sender_id === userId ? 'You' : (activeRel?.counterparty_nickname || activeRel?.counterparty_name || ''), preview });
  }, [userId, activeRel]);

  const handleForward = useCallback(async (targetRelId: string) => {
    if (!forwardMsg || !userId) return;
    const p = parseMsg(forwardMsg.content);
    const srcName = forwardMsg.sender_id === userId ? 'You' : (activeRel?.counterparty_name || 'Unknown');
    const content = encodeForward(srcName, p.text, '');
    await sendMessage.mutateAsync({ relationship_id: targetRelId, content: content.replace('\n', '') });
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setForwardMsg(null);
  }, [forwardMsg, userId, activeRel, sendMessage, queryClient]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="flex overflow-hidden bg-background" style={{ height: 'calc(100vh - 56px)' }}>
      <ConversationSidebar conversations={conversations} currentUserId={userId || ''} />

      {activeConversationId && activeRel ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
          <ConversationHeader name={activeRel.counterparty_name} nickname={activeRel.counterparty_nickname} onBack={() => setActiveConversation(null)} onSearchToggle={() => setShowMsgSearch((v) => !v)} />
          <MessageTimeline messages={activeMessages} currentUserId={userId || ''} counterpartyName={activeRel.counterparty_name} scrollRef={setScrollRef} onReply={handleReply} onForward={setForwardMsg} relationshipId={activeConversationId} />
          <MessageComposer sending={sendMessage.isPending} onSend={handleSend} onTyping={signalTyping} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <div className="text-center">
            <div className="text-4xl mb-3">💬</div>
            <div className="font-bold mb-1">Select a conversation</div>
            <div className="text-[11px]">Choose a conversation from the left to start messaging</div>
          </div>
        </div>
      )}

      {activeConversationId && <ContextPanel relationship={activeRel} />}

      {/* Forward modal */}
      {forwardMsg && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setForwardMsg(null)}>
          <div className="bg-popover border border-border rounded-lg w-[320px] max-h-[400px] overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Forward size={16} className="text-foreground" />
              <span className="text-sm font-bold text-foreground">Forward Message</span>
              <button onClick={() => setForwardMsg(null)} className="ml-auto bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="px-4 py-2 border-b border-border text-[11px] text-muted-foreground italic truncate">
              "{parseMsg(forwardMsg.content).text.slice(0, 80)}…"
            </div>
            <div className="overflow-y-auto max-h-[280px]">
              {relationships.filter((r) => r.id !== activeConversationId).map((r) => {
                const pal = getPalette(r.counterparty_name);
                return (
                  <button key={r.id} onClick={() => handleForward(r.id)} className="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-accent/30 transition-colors cursor-pointer bg-transparent border-none">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-extrabold" style={{ background: pal.bg, color: pal.text }}>
                      {r.counterparty_name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[13px] font-semibold text-foreground">{r.counterparty_name}</span>
                  </button>
                );
              })}
              {relationships.filter((r) => r.id !== activeConversationId).length === 0 && (
                <div className="px-4 py-6 text-center text-muted-foreground text-xs">No other contacts</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
