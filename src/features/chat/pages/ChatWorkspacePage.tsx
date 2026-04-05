/**
 * ChatWorkspacePage
 *
 * BUG 3 FIX: Wire real reaction mutations (addReaction/removeReaction RPCs exist)
 *            and real deleteForMe (local cache removal). Previously all callbacks
 *            were () => {} stubs so every interaction was silently dropped.
 *
 * BUG 9 FIX: /pnl command reads actual tracker KPIs instead of sending the
 *            hardcoded "+2.4% | Volume: 45k USDT" string.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRooms } from '@/features/chat/hooks/useRooms';
import { useRoomMessages } from '@/features/chat/hooks/useRoomMessages';
import { useUnreadState } from '@/features/chat/hooks/useUnreadState';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { MessageList } from '@/features/chat/components/MessageList';
import { CallOrchestrator } from '@/features/chat/components/CallOrchestrator';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import { SecureWatermark } from '@/features/chat/components/SecureWatermark';
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { useChatStore } from '@/lib/chat-store';
import { addReaction, removeReaction } from '@/features/chat/api/reactions';
import { useTrackerState } from '@/lib/useTrackerState';
import { kpiFor, fmtU, fmtPct } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const qc             = useQueryClient();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId  = merchantProfile?.merchant_id || authUserId || '';
  const isMobile = useIsMobile();
  const { settings } = useTheme();

  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];

  const [activeRoomId, setActiveRoomId] = useState<string | null>(searchParams.get('roomId'));
  const [showContext,  setShowContext]  = useState(!isMobile);
  const [showSidebar,  setShowSidebar]  = useState(true);

  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  // Auto-select first room if none chosen
  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      setActiveRoomId(String(rooms[0].room_id));
    }
  }, [rooms, activeRoomId]);

  useEffect(() => {
    setActiveConversation(activeRoomId);
  }, [activeRoomId, setActiveConversation]);

  // ── Messages ─────────────────────────────────────────────────────────────

  const messages = useRoomMessages(activeRoomId);
  const { firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);

  // ── BUG 9 FIX: real P&L for /pnl command ─────────────────────────────────

  const { state: trackerState, derived } = useTrackerState({
    lowStockThreshold:   settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range:               settings.range,
    currency:            settings.currency,
  });

  const pnlSummary = useMemo(() => {
    const d = kpiFor(trackerState, derived, settings.range);
    const stock = fmtU(derived.stockBalance);
    const net   = `${d.net >= 0 ? '+' : ''}${fmtU(d.net)} USDT`;
    const margin = fmtPct(d.count > 0 ? d.net / Math.max(d.rev, 1) : 0);
    const trades = d.count;
    return `Net P&L: ${net} · Margin: ${margin} · Trades: ${trades} · Stock: ${stock} USDT`;
  }, [trackerState, derived, settings.range]);

  // ── BUG 3 FIX: reaction mutations ────────────────────────────────────────

  // Track reactions per message in local state (loaded per room)
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, Record<string, string[]>>>({});

  // Load reactions when room changes
  useEffect(() => {
    if (!activeRoomId) return;
    (async () => {
      const { addReaction: _a, removeReaction: _r, getMessageReactions } = await import('@/features/chat/api/reactions');
      const res = await getMessageReactions(activeRoomId);
      if (!res.ok) return;
      const grouped: Record<string, Record<string, string[]>> = {};
      for (const r of res.data) {
        if (!grouped[r.message_id]) grouped[r.message_id] = {};
        if (!grouped[r.message_id][r.reaction]) grouped[r.message_id][r.reaction] = [];
        grouped[r.message_id][r.reaction].push(r.user_id);
      }
      setReactionsByMessage(grouped);
    })();
  }, [activeRoomId]);

  const handleReact = useCallback(async (messageId: string, emoji: string) => {
    if (!activeRoomId) return;
    const existing = reactionsByMessage[messageId]?.[emoji] ?? [];
    const alreadyReacted = existing.includes(userId);

    // Optimistic update
    setReactionsByMessage((prev) => {
      const msgReactions = { ...(prev[messageId] ?? {}) };
      if (alreadyReacted) {
        msgReactions[emoji] = (msgReactions[emoji] ?? []).filter((u) => u !== userId);
      } else {
        msgReactions[emoji] = [...(msgReactions[emoji] ?? []), userId];
      }
      return { ...prev, [messageId]: msgReactions };
    });

    // Persist
    const res = alreadyReacted
      ? await removeReaction(activeRoomId, messageId, emoji)
      : await addReaction(activeRoomId, messageId, emoji);

    if (!res.ok) {
      toast.error('Reaction failed');
      // Rollback optimistic update
      setReactionsByMessage((prev) => {
        const msgReactions = { ...(prev[messageId] ?? {}) };
        if (alreadyReacted) {
          msgReactions[emoji] = [...(msgReactions[emoji] ?? []), userId];
        } else {
          msgReactions[emoji] = (msgReactions[emoji] ?? []).filter((u) => u !== userId);
        }
        return { ...prev, [messageId]: msgReactions };
      });
    }
  }, [activeRoomId, userId, reactionsByMessage]);

  // ── BUG 3 FIX: delete for me (local cache removal, exported from hook) ───

  const handleDeleteForMe = useCallback((messageId: string) => {
    messages.deleteForMe(messageId);
  }, [messages]);

  // ── WebRTC ────────────────────────────────────────────────────────────────

  const {
    callState, isIncoming, callerId, remoteStream,
    initiateCall, acceptCall, endCall, toggleMute,
  } = useWebRTC({
    roomId: activeRoomId,
    userId,
    onTimelineEvent: (type) => messages.send.mutate({
      content: `||SYS_CALL||${type}||/SYS_CALL||`,
      type: 'system',
    }),
  });

  // ── Relationship metadata (for header title) ──────────────────────────────

  const { data: relationship } = useQuery({
    queryKey: ['chat-relationship', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return null;
      const { data: rel } = await supabase
        .from('merchant_relationships')
        .select('*')
        .eq('id', activeRoomId)
        .maybeSingle();
      if (!rel) return null;
      const cpId = rel.merchant_a_id === merchantProfile?.merchant_id
        ? rel.merchant_b_id
        : rel.merchant_a_id;
      const { data: cp } = await supabase
        .from('merchant_profiles')
        .select('display_name, nickname')
        .eq('merchant_id', cpId)
        .maybeSingle();
      return {
        ...rel,
        counterparty_name:     cp?.display_name || cpId,
        counterparty_nickname: cp?.nickname     || cpId,
      };
    },
    enabled: !!activeRoomId && !!merchantProfile,
  });

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background select-none">
      <CallOrchestrator
        callState={callState} isIncoming={isIncoming} callerId={callerId}
        remoteStream={remoteStream} acceptCall={acceptCall} rejectCall={endCall}
        toggleMute={toggleMute} endCall={endCall}
      />

      {/* Col 1: Inbox */}
      {(!isMobile || showSidebar) && (
        <ConversationSidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={(id) => { setActiveRoomId(id); if (isMobile) setShowSidebar(false); }}
          currentUserId={userId}
          isMobile={isMobile}
        />
      )}

      {/* Col 2: Timeline */}
      {(!isMobile || !showSidebar) && (
        <main className="flex-1 flex flex-col min-w-0 bg-background border-l border-border relative">
          {activeRoomId ? (
            <>
              <ConversationHeader
                title={relationship?.counterparty_name}
                onDashboardToggle={() => setShowContext(!showContext)}
                onCallVoice={() => initiateCall(false)}
                onCallVideo={() => initiateCall(true)}
                onBack={isMobile ? () => setShowSidebar(true) : undefined}
                showDashboard={showContext}
              />
              <div className="flex-1 overflow-hidden relative flex flex-col">
                <SecureWatermark enabled={true} />
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <MessageList
                    messages={messages.data ?? []}
                    currentUserId={userId}
                    unreadMessageId={firstUnread}
                    reactionsByMessage={reactionsByMessage[activeRoomId ?? ''] as any ?? {}}
                    pinnedSet={new Set()}
                    onReact={handleReact}                  // BUG 3 FIX: wired
                    onPinToggle={() => {}}                 // needs backend: fn_chat_pin_message RPC
                    onMarkRead={(id) => messages.read.mutate(id)}
                    onDeleteForMe={handleDeleteForMe}      // BUG 3 FIX: wired
                    onDeleteForEveryone={() => {}}         // needs backend: fn_chat_delete_message RPC
                    onCreateOrder={() => navigate('/trading/orders?new=true')}
                    onCreateTask={() => navigate('/trading/orders')}
                  />
                </div>
                <MessageComposer
                  sending={messages.send.isPending}
                  onTyping={() => {}}
                  onSend={(p) => messages.send.mutate(p)}
                  pnlSummary={pnlSummary}                 // BUG 9 FIX: real data
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-40">
              <Shield size={48} className="text-muted-foreground" />
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">Secure Environment Ready</p>
            </div>
          )}
        </main>
      )}

      {/* Col 3: Context panel */}
      {!isMobile && showContext && activeRoomId && (
        <ContextPanel relationship={relationship ?? null} />
      )}
    </div>
  );
}
