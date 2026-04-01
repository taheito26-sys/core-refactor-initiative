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
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { Shield } from 'lucide-react';
import { SecureTradePanel } from '@/features/chat/components/SecureTradePanel';
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
  const [showDashboard, setShowDashboard] = useState(!isMobile);
  // On mobile: true = show sidebar, false = show chat
  const [showSidebar, setShowSidebar] = useState(true);
  const pendingNotificationNav = useChatStore((s) => s.pendingNotificationNav);
  const pendingNotificationNavVersion = useChatStore((s) => s.pendingNotificationNavVersion);
  const setPendingNav = useChatStore((s) => s.setPendingNav);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setAttention = useChatStore((s) => s.setAttention);
  const [pendingNotificationMessageId, setPendingNotificationMessageId] = useState<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const [mobileBottomInset, setMobileBottomInset] = useState(0);

  const activeRoom = useMemo(
    () => rooms.find((r) => String(r.id) === String(activeRoomId) || String(r.room_id) === String(activeRoomId)) ?? null,
    [rooms, activeRoomId]
  );

  // Only auto-select first room when there is NO notification-driven navigation intent
  useEffect(() => {
    if (activeRoomId) return;
    if (rooms.length === 0) return;
    // Guard: don't auto-select if a notification deep-link is pending
    const hasRoomIdParam = !!searchParams.get('roomId');
    const hasMerchantIdParam = !!searchParams.get('merchantId');
    const hasPendingNav = !!pendingNotificationNav;
    if (hasRoomIdParam || hasMerchantIdParam || hasPendingNav) return;
    setActiveRoomId(String(rooms[0].room_id || rooms[0].id));
  }, [rooms, activeRoomId, searchParams, pendingNotificationNav]);

  useEffect(() => {
    const roomId = searchParams.get('roomId');
    if (roomId && String(roomId) !== String(activeRoomId)) {
      setActiveRoomId(String(roomId));
      if (isMobile) setShowSidebar(false);
    }
  }, [searchParams, activeRoomId, isMobile]);



  useEffect(() => {
    setActiveConversation(activeRoomId ? String(activeRoomId) : null);
  }, [activeRoomId, setActiveConversation]);

  useEffect(() => {
    setAttention({ inChatModule: true, activeConversationVisible: !isMobile || !showSidebar });
    const onVisibility = () => setAttention({ appFocused: !document.hidden });
    const onFocus = () => setAttention({ appFocused: true });
    const onBlur = () => setAttention({ appFocused: false });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      setAttention({ inChatModule: false, activeConversationVisible: false });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [setAttention, isMobile, showSidebar]);

  useEffect(() => {
    const roomIdParam = searchParams.get('roomId');
    const merchantIdParam = searchParams.get('merchantId');

    const resolveRoom = async (counterpartyMerchantId: string) => {
      const result = await getOrCreateDirectRoom(counterpartyMerchantId);
      if (!result.ok || !result.data) return;
      if (String(result.data) !== String(activeRoomId)) {
        setActiveRoomId(String(result.data));
      }
      refetchRooms();
      if (isMobile) setShowSidebar(false);
    };

    if (merchantIdParam && merchantIdParam !== userId) {
      void resolveRoom(merchantIdParam);
      return;
    }

    if (roomIdParam && !UUID_RE.test(roomIdParam) && roomIdParam !== userId) {
      void resolveRoom(roomIdParam);
    }
  }, [searchParams, userId, activeRoomId, refetchRooms, isMobile]);


  useEffect(() => {
    const pending = pendingNotificationNav;
    if (!pending) return;

    setActiveRoomId(String(pending.conversationId));
    if (pending.messageId) setPendingNotificationMessageId(String(pending.messageId));
    if (isMobile) setShowSidebar(false);
  }, [pendingNotificationNavVersion, pendingNotificationNav, isMobile]);

  const messages = useRoomMessages(activeRoomId);
  const { roomUnreadCount, firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);
  const {
    callState,
    isIncoming,
    callerId,
    remoteStream,
    initiateCall,
    acceptCall,
    rejectCall,
    toggleMute,
    endCall,
  } = useWebRTC({
    roomId: activeRoomId,
    userId,
    onTimelineEvent: (eventType) => {
      const labels: Record<string, string> = {
        call_started: 'Call started',
        call_accepted: 'Call accepted',
        call_rejected: 'Call rejected',
        call_missed: 'Call missed',
        call_ended: 'Call ended',
      };
      const label = labels[eventType] ?? eventType;
      messages.send.mutate({ content: `||SYS_CALL||${label}||/SYS_CALL||`, type: 'system' });
    },
  });

  const handleCall = (is_video: boolean) => initiateCall(is_video);

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    if (isMobile) setShowSidebar(false);
  };

  const handleBack = () => {
    setShowSidebar(true);
  };


  const scrollToMessage = useCallback((messageId: string | null, highlight = false) => {
    if (!messageId) return;
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlight) {
      el.classList.add('ring-2', 'ring-primary/60', 'rounded-xl');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary/60', 'rounded-xl'), 1800);
    }
  }, []);

  // ── Resolve relationship for the active room ──
  const { data: relationship } = useQuery({
    queryKey: ['chat-relationship', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return null;
      const { data: rel } = await supabase
        .from('merchant_relationships')
        .select('id, merchant_a_id, merchant_b_id, status')
        .eq('id', activeRoomId)
        .maybeSingle();
      if (!rel) return null;

      const myMerchantId = merchantProfile?.merchant_id;
      const counterpartyMerchantId = rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id;

      const { data: cpProfile } = await supabase
        .from('merchant_profiles')
        .select('display_name, nickname, merchant_code')
        .eq('merchant_id', counterpartyMerchantId)
        .maybeSingle();

      return {
        id: rel.id,
        merchant_a_id: rel.merchant_a_id,
        merchant_b_id: rel.merchant_b_id,
        counterparty_name: cpProfile?.display_name || counterpartyMerchantId,
        counterparty_nickname: cpProfile?.nickname || counterpartyMerchantId,
        counterparty_code: cpProfile?.merchant_code || undefined,
      };
    },
    enabled: !!activeRoomId && !!merchantProfile,
    staleTime: 30_000,
  });

  const isSecure = activeRoom?.type === 'deal' || !!activeRoom?.order_id;
  const roomTitle = relationship?.counterparty_nickname || relationship?.counterparty_name || activeRoom?.name || activeRoom?.title || 'Conversation';


  useEffect(() => {
    const messageId = searchParams.get('messageId');
    if (messageId) {
      window.setTimeout(() => scrollToMessage(messageId, true), 160);
    }
  }, [searchParams, scrollToMessage, messages.data]);


  useEffect(() => {
    if (!pendingNotificationMessageId) return;
    if (!activeRoomId) return;

    window.setTimeout(() => {
      scrollToMessage(pendingNotificationMessageId, true);
      setPendingNotificationMessageId(null);
      setPendingNav(null);
    }, 220);
  }, [pendingNotificationMessageId, activeRoomId, messages.data, scrollToMessage, setPendingNav]);


  useEffect(() => {
    if (!timelineScrollRef.current) return;
    if (!messages.data?.length) return;

    const hasDirectMessageTarget = Boolean(searchParams.get('messageId')) || Boolean(pendingNotificationMessageId);
    if (hasDirectMessageTarget) return;

    // Keep newest messages anchored at the bottom of the timeline.
    timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
  }, [activeRoomId, messages.data, searchParams, pendingNotificationMessageId]);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') {
      setMobileBottomInset(0);
      return;
    }

    const updateInset = () => {
      const viewport = window.visualViewport;
      const safeAreaBottom = 12;

      if (!viewport) {
        setMobileBottomInset(safeAreaBottom);
        return;
      }

      const keyboardOverlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setMobileBottomInset(Math.max(safeAreaBottom, keyboardOverlap + 8));
    };

    updateInset();

    window.visualViewport?.addEventListener('resize', updateInset);
    window.visualViewport?.addEventListener('scroll', updateInset);
    window.addEventListener('orientationchange', updateInset);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateInset);
      window.visualViewport?.removeEventListener('scroll', updateInset);
      window.removeEventListener('orientationchange', updateInset);
    };
  }, [isMobile]);

  return (
    <div
      className="flex h-[calc(100vh-50px)] w-full overflow-hidden bg-background select-none relative"
      style={isMobile ? { height: '100dvh' } : undefined}
    >
      <CallOrchestrator
        callState={callState}
        isIncoming={isIncoming}
        callerId={callerId}
        remoteStream={remoteStream}
        acceptCall={acceptCall}
        rejectCall={rejectCall}
        toggleMute={toggleMute}
        endCall={endCall}
      />

      {/* Sidebar — full-screen on mobile, fixed-width on desktop */}
      {(!isMobile || showSidebar) && (
        <ConversationSidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          currentUserId={userId}
          isMobile={isMobile}
        />
      )}

      {/* Main Chat — hidden on mobile when sidebar is showing */}
      {(!isMobile || !showSidebar) && (
        <main className="flex-1 flex flex-col relative h-full min-w-0 bg-background border-l border-border overflow-hidden">
          {activeRoom ? (
            <>
              <ConversationHeader
                title={roomTitle}
                onSummarize={isMobile ? undefined : () => {}}
                onSearchToggle={() => setShowSearch(!showSearch)}
                onDashboardToggle={isMobile ? undefined : () => setShowDashboard(!showDashboard)}
                onCallVoice={() => handleCall(false)}
                onCallVideo={() => handleCall(true)}
                showDashboard={showDashboard}
                onBack={isMobile ? handleBack : undefined}
              />

              <div className="flex-1 flex flex-col overflow-hidden w-full relative">
                <div className="w-full flex-1 flex flex-col overflow-hidden relative">

                  {isSecure && (
                    <div className="px-4 py-1 shrink-0 scale-90 origin-top z-40">
                      <SecureTradePanel
                        orderId={activeRoom.order_id || 'ORD-1042'}
                        buyer="Mohamed"
                        amount="20k USDT"
                        rate="3.672"
                        total="73.4k"
                        expiresIn="29m"
                        onSettle={() => {}}
                        onCancel={() => {}}
                      />
                    </div>
                  )}

                  <div ref={timelineScrollRef} className="flex-1 overflow-y-auto custom-scrollbar relative z-10 py-2">
                    <div className={isMobile ? "w-full" : "max-w-4xl mx-auto w-full"}>
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
                    <JumpToUnreadButton visible={(roomUnreadCount || 0) > 0} onClick={() => scrollToMessage(firstUnread, true)} />
                  </div>

                  <div
                    className="shrink-0 bg-background/60 backdrop-blur-lg border-t border-border relative z-20"
                    style={isMobile ? { paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${mobileBottomInset}px)` } : undefined}
                  >
                    <div className={isMobile ? "w-full" : "max-w-4xl mx-auto w-full scale-95 origin-bottom"}>
                      <MessageComposer
                        sending={messages.send.isPending}
                        onTyping={() => {}}
                        onSend={(payload) => messages.send.mutate(payload)}
                        replyTo={replyTo}
                        onCancelReply={() => setReplyTo(null)}
                        compact={isMobile}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-background space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
                <Shield size={32} />
              </div>
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground font-black uppercase tracking-[0.3em]">Operational Readiness</p>
                <p className="text-[9px] text-muted-foreground font-bold mt-1">Select a room to start session</p>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Context Panel — desktop only */}
      {!isMobile && showDashboard && (
        <ContextPanel relationship={relationship ?? null} />
      )}
    </div>
  );
}
