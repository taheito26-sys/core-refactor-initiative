import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { JumpToUnreadButton } from '@/features/chat/components/JumpToUnreadButton';
import { CallOrchestrator } from '@/features/chat/components/CallOrchestrator';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { Shield, Lock, Phone, Video, Info, X } from 'lucide-react';
import { SecureTradePanel } from '@/features/chat/components/SecureTradePanel';
import { cn } from '@/lib/utils';

export default function ChatWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId = merchantProfile?.merchant_id || authUserId || '';
  const isMobile = useIsMobile();
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showDashboard, setShowDashboard] = useState(!isMobile);
  const [showSidebar, setShowSidebar] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);

  const activeRoom = useMemo(
    () => rooms.find((r) => String(r.id) === String(activeRoomId) || String(r.room_id) === String(activeRoomId)) ?? null,
    [rooms, activeRoomId]
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      const firstId = String(rooms[0].room_id || rooms[0].id);
      setActiveRoomId(firstId);
    }
  }, [rooms, activeRoomId]);

  useEffect(() => {
    const roomId = searchParams.get('roomId');
    if (roomId && String(roomId) !== String(activeRoomId)) {
      setActiveRoomId(String(roomId));
      if (isMobile) setShowSidebar(false);
    }
  }, [searchParams, activeRoomId, isMobile]);

  const messages = useRoomMessages(activeRoomId);
  const { roomUnreadCount, firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);
  const { initiateCall, callState, isIncoming, callerId, remoteStream, acceptCall, rejectCall, toggleMute, endCall } = useWebRTC({ roomId: activeRoomId, userId });

  const handleCall = (is_video: boolean) => initiateCall(is_video);

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    if (isMobile) setShowSidebar(false);
  };

  const handleBack = () => {
    setShowSidebar(true);
  };

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50/50 select-none">
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar */}
        {(!isMobile || showSidebar) && (
          <ConversationSidebar
            rooms={rooms}
            activeRoomId={activeRoomId}
            onSelectRoom={handleSelectRoom}
            currentUserId={userId}
            isMobile={isMobile}
          />
        )}

        {/* Main Chat Area */}
        {(!isMobile || !showSidebar) && (
          <div className="flex-1 flex flex-col min-w-0 bg-white relative overflow-hidden">
            <CallOrchestrator roomId={activeRoomId} callState={callState} isIncoming={isIncoming} callerId={callerId} remoteStream={remoteStream} acceptCall={acceptCall} rejectCall={rejectCall} toggleMute={toggleMute} endCall={endCall} />
            
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
                  {isSecure && (
                    <div className="px-4 py-1 shrink-0 scale-90 origin-top z-40">
                      <SecureTradePanel
                        orderId={activeRoom.order_id || 'ORD-1042'}
                        buyer="Trade Partner"
                        amount="20k USDT"
                        rate="3.672"
                        total="73.4k"
                        expiresIn="29m"
                        onSettle={() => {}}
                        onCancel={() => {}}
                      />
                    </div>
                  )}

                  <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto custom-scrollbar relative z-10 py-2 bg-slate-50/30"
                  >
                    <div className={cn("w-full h-full", !isMobile && "max-w-4xl mx-auto")}>
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

                  <div className="shrink-0 bg-white/80 backdrop-blur-xl border-t border-slate-100 relative z-20">
                    <div className={cn("w-full transition-all", !isMobile && "max-w-4xl mx-auto scale-95 origin-bottom")}>
                      <MessageComposer
                        sending={isSending}
                        onTyping={() => {}}
                        onSend={(payload) => {
                          if (!activeRoomId) return;
                          setIsSending(true);
                          supabase.from('merchant_messages').insert([{
                            relationship_id: activeRoomId,
                            sender_id: userId,
                            content: payload.content,
                            msg_type: payload.type || 'text',
                          }]).then(() => setIsSending(false));
                        }}
                        replyTo={replyTo}
                        onCancelReply={() => setReplyTo(null)}
                        compact={isMobile}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 space-y-6">
                <div className="w-20 h-20 rounded-3xl bg-white shadow-xl flex items-center justify-center text-slate-200">
                  <Shield size={40} />
                </div>
                <div className="text-center">
                  <p className="text-[12px] text-slate-400 font-black uppercase tracking-[0.4em]">Secure Terminal</p>
                  <p className="text-[10px] text-slate-300 font-bold mt-2">Select a trade room to initiate session</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Global Search / Dashboard Panel */}
        {!isMobile && showDashboard && (
          <ContextPanel relationship={relationship ?? null} />
        )}
      </div>
    </div>
  );
}
