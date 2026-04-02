import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRooms } from '@/features/chat/hooks/useRooms';
import { getOrCreateDirectRoom } from '@/features/chat/api/rooms';
import { useRoomMessages } from '@/features/chat/hooks/useRoomMessages';
import { useUnreadState } from '@/features/chat/hooks/useUnreadState';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { MessageList } from '@/features/chat/components/MessageList';
import { JumpToUnreadButton } from '@/features/chat/components/JumpToUnreadButton';
import { CallOrchestrator } from '@/features/chat/components/CallOrchestrator';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import { SecureWatermark } from '@/features/chat/components/SecureWatermark';
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { Shield, Lock, Zap } from 'lucide-react';
import { SecureTradePanel } from '@/features/chat/components/SecureTradePanel';
import { TradingActionBar } from '@/features/chat/components/TradingActionBar';
import { useChatStore } from '@/lib/chat-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId = merchantProfile?.merchant_id || authUserId || '';
  const isMobile = useIsMobile();
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const refetchRooms = roomsQuery.refetch;
  
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showContext, setShowContext] = useState(!isMobile);
  const [showSidebar, setShowSidebar] = useState(true);
  
  const pendingNotificationNav = useChatStore((s) => s.pendingNotificationNav);
  const setPendingNav = useChatStore((s) => s.setPendingNav);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setAttention = useChatStore((s) => s.setAttention);
  
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const [mobileBottomInset, setMobileBottomInset] = useState(0);

  const activeRoom = useMemo(
    () => rooms.find((r) => String(r.id) === String(activeRoomId) || String(r.room_id) === String(activeRoomId)) ?? null,
    [rooms, activeRoomId]
  );

  useEffect(() => {
    if (activeRoomId || rooms.length === 0) return;
    const hasRoomIdParam = !!searchParams.get('roomId');
    const hasMerchantIdParam = !!searchParams.get('merchantId');
    if (hasRoomIdParam || hasMerchantIdParam || pendingNotificationNav) return;
    setActiveRoomId(String(rooms[0].room_id || rooms[0].id));
  }, [rooms, activeRoomId, searchParams, pendingNotificationNav]);

  useEffect(() => {
    setActiveConversation(activeRoomId ? String(activeRoomId) : null);
    setAttention({ inChatModule: true, activeConversationVisible: !isMobile || !showSidebar });
  }, [activeRoomId, setActiveConversation, setAttention, isMobile, showSidebar]);

  const messages = useRoomMessages(activeRoomId);
  const { roomUnreadCount, firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);
  
  const {
    callState, isIncoming, callerId, remoteStream,
    initiateCall, acceptCall, rejectCall, toggleMute, endCall,
  } = useWebRTC({
    roomId: activeRoomId,
    userId,
    onTimelineEvent: (eventType) => {
      messages.send.mutate({ content: `||SYS_CALL||${eventType}||/SYS_CALL||`, type: 'system' });
    },
  });

  const { data: relationship } = useQuery({
    queryKey: ['chat-relationship', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return null;
      const { data: rel } = await supabase.from('merchant_relationships').select('*').eq('id', activeRoomId).maybeSingle();
      if (!rel) return null;
      const myMerchantId = merchantProfile?.merchant_id;
      const cpId = rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id;
      const { data: cp } = await supabase.from('merchant_profiles').select('display_name, nickname, merchant_code').eq('merchant_id', cpId).maybeSingle();
      return { ...rel, counterparty_name: cp?.display_name || cpId, counterparty_nickname: cp?.nickname || cpId };
    },
    enabled: !!activeRoomId && !!merchantProfile,
  });

  const isSecure = activeRoom?.type === 'deal' || !!activeRoom?.order_id;
  const roomTitle = relationship?.counterparty_nickname || activeRoom?.name || 'Conversation';

  return (
    <div className="flex h-full w-full overflow-hidden bg-background relative">
      <CallOrchestrator
        callState={callState} isIncoming={isIncoming} callerId={callerId}
        remoteStream={remoteStream} acceptCall={acceptCall} rejectCall={rejectCall}
        toggleMute={toggleMute} endCall={endCall}
      />

      {/* Column 1: Inbox Sidebar */}
      {(!isMobile || showSidebar) && (
        <ConversationSidebar
          rooms={rooms} activeRoomId={activeRoomId}
          onSelectRoom={(id) => { setActiveRoomId(id); if (isMobile) setShowSidebar(false); }}
          currentUserId={userId} isMobile={isMobile}
        />
      )}

      {/* Column 2: Message Timeline */}
      {(!isMobile || !showSidebar) && (
        <main className="flex-1 flex flex-col relative h-full min-w-0 bg-background border-l border-border overflow-hidden">
          {activeRoom ? (
            <>
              <ConversationHeader
                title={roomTitle}
                onSearchToggle={() => setShowSearch(!showSearch)}
                onDashboardToggle={() => setShowContext(!showContext)}
                onCallVoice={() => initiateCall(false)}
                onCallVideo={() => initiateCall(true)}
                showDashboard={showContext}
                onBack={isMobile ? () => setShowSidebar(true) : undefined}
              />

              <div className="flex-1 flex flex-col overflow-hidden relative">
                <SecureWatermark enabled={isSecure} />
                
                {isSecure && (
                  <div className="px-4 py-2 shrink-0 z-40">
                    <SecureTradePanel
                      orderId={activeRoom.order_id || 'ORD-1042'}
                      buyer="Verified Counterparty"
                      amount="--" rate="--" total="--" expiresIn="Active"
                    />
                  </div>
                )}

                <div ref={timelineScrollRef} className="flex-1 overflow-y-auto relative z-10 py-2 custom-scrollbar">
                  <div className="max-w-4xl mx-auto w-full">
                    <MessageList
                      messages={messages.data ?? []}
                      currentUserId={userId}
                      unreadMessageId={firstUnread}
                      reactionsByMessage={{}}
                      pinnedSet={new Set()}
                      onReact={() => {}}
                      onPinToggle={() => {}}
                      onMarkRead={(id) => messages.read.mutate(id)}
                      onDeleteForMe={() => {}}
                      onDeleteForEveryone={() => {}}
                      onCreateOrder={() => {}}
                      onCreateTask={() => {}}
                      onReply={(m) => setReplyTo(m)}
                    />
                  </div>
                  <JumpToUnreadButton visible={(roomUnreadCount || 0) > 0} onClick={() => {}} />
                </div>

                <div className="shrink-0 bg-background/80 backdrop-blur-xl border-t border-border z-20">
                  <div className="max-w-4xl mx-auto w-full">
                    <MessageComposer
                      sending={messages.send.isPending}
                      onTyping={() => {}}
                      onSend={(p) => messages.send.mutate(p)}
                      replyTo={replyTo}
                      onCancelReply={() => setReplyTo(null)}
                      compact={isMobile}
                    />
                  </div>
                </div>
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

      {/* Column 3: Context Panel */}
      {!isMobile && showContext && activeRoom && (
        <ContextPanel relationship={relationship ?? null} />
      )}

      {/* Column 4: Trading Actions (Desktop Only) */}
      {!isMobile && showContext && activeRoom && (
        <aside className="w-[240px] border-l border-border bg-muted/30 flex flex-col shrink-0">
          <div className="p-4 border-b border-border bg-background">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Zap size={12} className="text-primary" /> Trading Actions
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TradingActionBar 
              onCreateOrder={() => navigate('/trading/orders?new=true')}
              onCheckStock={() => navigate('/trading/stock')}
            />
          </div>
        </aside>
      )}
    </div>
  );
}