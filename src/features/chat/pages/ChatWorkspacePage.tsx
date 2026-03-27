import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useWebRTC } from '@/features/chat/hooks/useWebRTC';
import { Shield, BarChart3, Cloud } from 'lucide-react';

import { MOCK_OS_USER } from '@/lib/os-store';
import { SecureTradePanel } from '@/features/chat/components/SecureTradePanel';
import { TradingActionBar } from '@/features/chat/components/TradingActionBar';
import { randomUUID } from '@/features/chat/utils/uuid';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const { userId: authUserId, merchantProfile } = useAuth();
  const userId = merchantProfile?.merchant_id || authUserId || MOCK_OS_USER.id;
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  
  const activeRoom = useMemo(
    () => rooms.find((r) => String(r.id) === String(activeRoomId)) ?? null,
    [rooms, activeRoomId]
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) setActiveRoomId(String(rooms[0].id));
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

  const isSecure = activeRoom?.type === 'deal' || !!activeRoom?.order_id;
  
  const watermarkText = `SECURE TRADING SURFACE - ${userId} - ${new Date().toISOString().split('T')[0]}`;
  const watermarkBg = isSecure
    ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='300' opacity='0.008' transform='rotate(-20)'><text x='0' y='150' font-family='sans-serif' font-size='8' font-weight='900' fill='%23000'>${watermarkText}</text></svg>")`
    : 'none';

  return (
    <div className="flex h-[calc(100vh-50px)] w-full overflow-hidden bg-white select-none relative">
      <CallOrchestrator roomId={activeRoomId} />
      
      {/* NO SIDEBAR OVERRIDES - Reverting to Standard OS Global Sidebar */}

      {/* Column 2: Inbox Sidebar */}
      <ConversationSidebar 
        rooms={rooms} 
        activeRoomId={activeRoomId} 
        onSelectRoom={setActiveRoomId} 
        currentUserId={userId}
      />

      {/* Column 3: Innovative Main Window - ZERO SCROLL ENFORCED */}
      <main className="flex-1 flex flex-col relative h-full min-w-0 bg-[#f8fafc] border-l border-slate-100 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none z-[99]" style={{ backgroundImage: watermarkBg }} />
        
        {activeRoom ? (
          <>
            <ConversationHeader
              title={activeRoom.name || activeRoom.title || 'Conversation'}
              onSummarize={() => {}}
              onSearchToggle={() => setShowSearch(!showSearch)}
              onDashboardToggle={() => setShowDashboard(!showDashboard)}
              onCallVoice={() => handleCall(false)}
              onCallVideo={() => handleCall(true)}
              showDashboard={showDashboard}
            />

            <div className="flex-1 flex flex-col overflow-hidden w-full relative">
              <div className="mx-auto w-full flex-1 flex flex-col overflow-hidden bg-white/40 relative">
                
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

                <div className="shrink-0 bg-white/60 backdrop-blur-lg border-t border-slate-100 relative z-20">
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
          <div className="flex-1 flex flex-col items-center justify-center bg-white space-y-4">
             <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-200">
                <Shield size={32} />
             </div>
             <div className="text-center">
                <p className="text-[11px] text-slate-400 font-black uppercase tracking-[0.3em]">Operational Readiness</p>
                <p className="text-[9px] text-slate-300 font-bold mt-1">Select valid room to start session</p>
             </div>
          </div>
        )}
      </main>

      {/* Column 4: Elegant Right Dashboard (Modern Command Center) */}
      <aside 
        className={`bg-white border-l border-slate-100 transition-all duration-300 relative z-30 flex flex-col h-full overflow-hidden ${
          showDashboard ? 'w-[210px]' : 'w-0 border-l-0'
        }`}
      >
        <div className="flex-1 flex flex-col h-full overflow-hidden w-[210px]">
          <div className="p-6 pb-4 flex flex-col items-center text-center space-y-4 border-b border-slate-50 shrink-0">
            <div className="w-16 h-16 rounded-[24px] bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white text-3xl font-black shadow-xl shadow-violet-200 ring-4 ring-white">
              {(activeRoom?.name || activeRoom?.title || 'M').charAt(0)}
            </div>
            <div>
              <h3 className="text-[15px] font-black text-slate-900 leading-tight truncate w-[170px] uppercase tracking-tighter">{activeRoom?.name || activeRoom?.title || 'Merchant'}</h3>
              <p className="text-[9px] text-violet-500 font-black uppercase tracking-widest mt-1">Verified Node: 2947</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
             <div className="space-y-4">
                <TradingActionBar 
                   onCreateOrder={() => {}}
                   onCheckStock={() => {}}
                   onPaymentRequest={() => {}}
                   onOffsetRequest={() => {}}
                />
             </div>

             <div className="space-y-3 border-t border-slate-100 pt-5">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <BarChart3 size={11} className="text-slate-300" />
                   Session Intel
                </h4>
                <div className="space-y-2">
                   <div className="p-3 rounded-xl bg-slate-50/50 border border-slate-100 flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[9px] font-black text-slate-500 uppercase">
                         Orders
                         <span className="text-slate-900">03</span>
                      </div>
                      <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                         <div className="bg-emerald-500 h-full w-[60%]" />
                      </div>
                   </div>
                </div>
             </div>

             <div className="pt-2">
                <div className="p-4 rounded-2xl bg-[#020617] text-white shadow-lg shadow-slate-200">
                   <div className="flex items-center gap-2 mb-3">
                      <Cloud size={14} className="text-blue-400" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/50">Cloud Sync</span>
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-white/40 uppercase">Safe Liquid</span>
                      <span className="text-xl font-black tracking-tighter">75.4k <span className="text-[10px] text-white/30 ml-1">USDT</span></span>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
