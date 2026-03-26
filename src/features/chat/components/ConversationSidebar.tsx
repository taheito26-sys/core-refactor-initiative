import { useMemo, useState } from 'react';
import type { ChatRoom, InboxLane } from '@/features/chat/lib/types';
import { User, Users, Megaphone, BadgeDollarSign } from 'lucide-react';

interface Props {
  rooms?: ChatRoom[];
  conversations?: Array<any>;
  currentUserId?: string;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

export function ConversationSidebar({ rooms, conversations, activeRoomId, onSelectRoom }: Props) {
  const [q, setQ] = useState('');
  const [activeLane, setActiveLane] = useState<InboxLane>('Personal');

  const lanes: { id: InboxLane; icon: any }[] = [
    { id: 'Personal', icon: User },
    { id: 'Team', icon: Users },
    { id: 'Customers', icon: Megaphone },
    { id: 'Deals', icon: BadgeDollarSign },
  ];

  const normalizedRooms = useMemo(() => {
    if (rooms && rooms.length) return rooms;
    return (conversations ?? []).map((c) => ({
      room_id: c.relationship_id,
      title: c.counterparty_name ?? c.counterparty_nickname ?? 'Room',
      unread_count: c.unread_count ?? 0,
      last_message_body: c.last_message ?? '',
    })) as ChatRoom[];
  }, [rooms, conversations]);

  const filtered = useMemo(() => {
    let list = normalizedRooms.filter(r => (r.lane || 'Personal') === activeLane);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((room) => (room.title ?? '').toLowerCase().includes(term));
  }, [q, normalizedRooms, activeLane]);

  return (
    <aside className="w-[320px] border-r border-border bg-background/70 backdrop-blur-sm flex flex-col">
      <div className="p-4 border-b border-border space-y-3">
        <h2 className="text-sm font-bold tracking-tight uppercase text-muted-foreground/80">Messaging OS</h2>
        
        <div className="flex bg-accent/20 rounded-lg p-1 gap-1">
          {lanes.map(lane => (
            <button
              key={lane.id}
              onClick={() => setActiveLane(lane.id)}
              className={`flex-1 flex flex-col items-center py-1.5 rounded-md transition ${activeLane === lane.id ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-accent/40'}`}
              title={lane.id}
            >
              <lane.icon size={14} />
              <span className="text-[9px] font-bold mt-1 uppercase tracking-tighter">{lane.id}</span>
            </button>
          ))}
        </div>

        <input
          className="w-full rounded-md border border-input bg-background/50 px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none transition"
          placeholder={`Search ${activeLane}...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="overflow-auto flex-1">
        {filtered.map((room) => (
          <button
            key={room.room_id}
            onClick={() => onSelectRoom?.(room.room_id)}
            className={`w-full text-left p-3 border-b border-border/50 hover:bg-accent/40 transition ${activeRoomId === room.room_id ? 'bg-accent/60' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium truncate">{room.title || 'Untitled Room'}</div>
              {Number(room.unread_count) > 0 && (
                <span className="text-[10px] rounded-full bg-primary text-primary-foreground px-2 py-0.5">
                  {room.unread_count}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate mt-1">{room.last_message_body || 'No messages yet'}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
