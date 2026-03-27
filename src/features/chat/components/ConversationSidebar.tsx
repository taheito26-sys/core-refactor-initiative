import { useMemo } from 'react';
import type { ChatRoom } from '@/features/chat/lib/types';
import { 
  Search,
  SlidersHorizontal
} from 'lucide-react';

interface Props {
  rooms?: ChatRoom[];
  conversations?: any[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  currentUserId: string;
}

export function ConversationSidebar({ rooms, conversations, activeRoomId, onSelectRoom }: Props) {
  const normalizedRooms = useMemo(() => {
    if (rooms && rooms.length) return rooms;
    return (conversations ?? []).map((c) => ({
      room_id: c.relationship_id || c.id,
      kind: c.kind ?? 'group',
      lane: c.lane ?? 'Personal',
      title: c.counterparty_name ?? c.counterparty_nickname ?? c.name ?? 'Room',
      unread_count: Number(c.unread_count ?? 0),
      last_message_body: c.last_message ?? '',
      last_message_at: c.last_message_at ?? null,
      type: c.room_type ?? c.type ?? 'standard',
      updated_at: c.updated_at ?? new Date().toISOString(),
    })) as unknown as ChatRoom[];
  }, [rooms, conversations]);

  return (
    <aside className="w-[200px] bg-white border-r border-slate-100 flex flex-col h-full overflow-hidden shrink-0">
      <div className="p-4 pb-2 shrink-0">
        <h2 className="text-base font-black text-slate-900 tracking-tighter mb-3 flex items-center justify-between">
          Inbox
          <SlidersHorizontal size={14} className="text-slate-300 cursor-pointer hover:text-violet-600 transition-colors" />
        </h2>
        <div className="relative mb-3">
           <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
           <input 
             type="text" 
             placeholder="Search..." 
             className="w-full bg-[#F8FAFC] border border-transparent rounded-lg py-2 pl-9 pr-2 text-[10px] font-medium outline-none focus:bg-white focus:border-violet-100 transition-all shadow-inner"
           />
        </div>
        
        <div className="flex gap-3 px-1 border-b border-slate-50 pb-1">
           <button className="relative text-[9px] font-black text-slate-900 uppercase tracking-widest pb-1.5 group">
             All
             <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-600" />
           </button>
           <button className="text-[9px] font-black text-slate-400 uppercase tracking-widest pb-1.5 hover:text-slate-600 transition-colors">VIP</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-0.5 pb-6 pt-1">
        {normalizedRooms.map((room) => {
          const isActive = activeRoomId && String(activeRoomId) === String(room.room_id);
          return (
            <button
              key={room.room_id}
              onClick={() => onSelectRoom?.(String(room.room_id))}
              className={`w-full group flex flex-col p-2.5 rounded-xl transition-all duration-200 relative ${
                isActive ? 'bg-slate-50 shadow-sm' : 'hover:bg-slate-50/50'
              }`}
            >
              <div className="flex items-center gap-2 w-full mb-1">
                <div className="relative shrink-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-[12px] font-black transition-all ${
                    isActive ? 'bg-violet-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {room.title?.charAt(0).toUpperCase()}
                  </div>
                  {room.unread_count > 0 && (
                    <div className="absolute -top-1 -right-1 bg-[#F43F5E] text-white text-[7px] font-black px-1 py-0.5 rounded-[3px] border border-white">
                      {room.unread_count}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0">
                    <span className={`text-[11px] font-black tracking-tight truncate ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>{room.title}</span>
                  </div>
                  <div className="flex items-center justify-between">
                     <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-widest truncate">{room.type === 'deal' ? 'SECURE Trade' : 'M-ID 2947'}</span>
                  </div>
                </div>
              </div>
              
              <p className={`text-[10px] line-clamp-1 text-left leading-tight ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>
                {room.last_message_body || 'Initiating trade...'}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
