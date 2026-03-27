import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
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
import { Shield } from 'lucide-react';
import { SecureTradePanel } from '@/features/chat/components/SecureTradePanel';
import { randomUUID } from '@/features/chat/utils/uuid';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId = merchantProfile?.merchant_id || authUserId || '';
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);

  const activeRoom = useMemo(
    () => rooms.find((r) => String(r.id) === String(activeRoomId) || String(r.room_id) === String(activeRoomId)) ?? null,
    [rooms, activeRoomId]
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) setActiveRoomId(String(rooms[0].room_id || rooms[0].id));
  }, [rooms, activeRoomId]);

  useEffect(() => {
    const roomId = searchParams.get('roomId');
    if (roomId && String(roomId) !== String(activeRoomId)) {
      setActiveRoomId(String(roomId));
    }
  }, [searchParams, activeRoomId]);

  const messages = useRoomMessages(activeRoomId);
  const { roomUnreadCount, firstUnreadMessageId: firstUnread } = useUnreadState(activeRoomId);

  const { initiateCall } = useWebRTC({ roomId: activeRoomId, userId });

  const handleCall = (is_video: boolean) => {
    initiateCall(is_video);
  };

  // ── Resolve relationship for the active room ──
  const { data: relationship } = useQuery({
    queryKey: ['chat-relationship', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return null;
      // Room IDs from migrated conversations = relationship IDs
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
    <div className="flex h-[calc(100vh-50px)] w-full overflow-hidden bg-background select-none relative">
      <CallOrchestrator roomId={activeRoomId} />

      {/* Column 1: Inbox Sidebar */}
      <ConversationSidebar
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        currentUserId={userId}
      />

      {/* Column 2: Main Chat Window */}
      <main className="flex-1 flex flex-col relative h-full min-w-0 bg-background border-l border-border overflow-hidden">
        {activeRoom ? (
          <>
            <ConversationHeader
              title={roomTitle}
              onSummarize={() => {}}
              onSearchToggle={() => setShowSearch(!showSearch)}
              onDashboardToggle={() => setShowDashboard(!showDashboard)}
              onCallVoice={() => handleCall(false)}
              onCallVideo={() => handleCall(true)}
              showDashboard={showDashboard}
            />

            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
              <div className="mx-auto w-full flex-1 flex flex-col overflow-hidden relative">

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

                <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 py-2">
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

                <div className="shrink-0 bg-background/60 backdrop-blur-lg border-t border-border relative z-20">
                  <div className="max-w-4xl mx-auto w-full scale-95 origin-bottom">
                    <MessageComposer
                      sending={messages.send.isPending}
                      onTyping={() => {}}
                      onSend={(payload) => messages.send.mutate(payload)}
                      replyTo={replyTo}
                      onCancelReply={() => setReplyTo(null)}
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

      {/* Column 3: Context Panel with real tracker data */}
      {showDashboard && (
        <ContextPanel
          relationship={relationship ?? null}
        />
      )}
    </div>
  );
}
