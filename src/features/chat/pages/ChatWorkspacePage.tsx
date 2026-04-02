import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { CallOrchestrator } from '@/features/chat/components/CallOrchestrator';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import { SecureWatermark } from '@/features/chat/components/SecureWatermark';
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { useChatStore } from '@/lib/chat-store';
import { Shield, Zap } from 'lucide-react';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId = merchantProfile?.merchant_id || authUserId || '';
  const isMobile = useIsMobile();
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  
  const [activeRoomId, setActiveRoomId] = useState<string | null>(searchParams.get('roomId'));
  const [showContext, setShowContext] = useState(!isMobile);
  const [showSidebar, setShowSidebar] = useState(true);
  
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      setActiveRoomId(String(rooms[0].room_id));
    }
  }, [rooms, activeRoomId]);

  useEffect(() => {
    setActiveConversation(activeRoomId);
  }, [activeRoomId, setActiveConversation]);

  const messages = useRoomMessages(activeRoomId);
  const { firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);
  
  const {
    callState, isIncoming, callerId, remoteStream,
    initiateCall, acceptCall, endCall, toggleMute,
  } = useWebRTC({
    roomId: activeRoomId,
    userId,
    onTimelineEvent: (type) => messages.send.mutate({ content: `||SYS_CALL||${type}||/SYS_CALL||`, type: 'system' }),
  });

  const { data: relationship } = useQuery({
    queryKey: ['chat-relationship', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return null;
      const { data: rel } = await supabase.from('merchant_relationships').select('*').eq('id', activeRoomId).maybeSingle();
      if (!rel) return null;
      const cpId = rel.merchant_a_id === merchantProfile?.merchant_id ? rel.merchant_b_id : rel.merchant_a_id;
      const { data: cp } = await supabase.from('merchant_profiles').select('display_name, nickname').eq('merchant_id', cpId).maybeSingle();
      return { ...rel, counterparty_name: cp?.display_name || cpId, counterparty_nickname: cp?.nickname || cpId };
    },
    enabled: !!activeRoomId && !!merchantProfile,
  });

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
          rooms={rooms} activeRoomId={activeRoomId}
          onSelectRoom={(id) => { setActiveRoomId(id); if (isMobile) setShowSidebar(false); }}
          currentUserId={userId} isMobile={isMobile}
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
                    reactionsByMessage={{}}
                    pinnedSet={new Set()}
                    onReact={() => {}}
                    onPinToggle={() => {}}
                    onMarkRead={(id) => messages.read.mutate(id)}
                    onDeleteForMe={() => {}}
                    onDeleteForEveryone={() => {}}
                    onCreateOrder={() => {}}
                    onCreateTask={() => {}}
                  />
                </div>
                <MessageComposer
                  sending={messages.send.isPending}
                  onTyping={() => {}}
                  onSend={(p) => messages.send.mutate(p)}
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

      {/* Col 3: Context */}
      {!isMobile && showContext && activeRoomId && (
        <ContextPanel relationship={relationship ?? null} />
      )}
    </div>
  );
}