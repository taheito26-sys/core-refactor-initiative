import { useMemo, useState } from 'react';
import type { ChatRoom } from '@/features/chat/lib/types';

interface Props {
  rooms?: ChatRoom[];
  conversations?: Array<any>;
  currentUserId?: string;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

export function ConversationSidebar({ rooms, conversations, activeRoomId, onSelectRoom }: Props) {
  const [q, setQ] = useState('');

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
    const term = q.trim().toLowerCase();
    if (!term) return normalizedRooms;
    return normalizedRooms.filter((room) => (room.title ?? '').toLowerCase().includes(term));
  }, [q, normalizedRooms]);

  return (
    <aside className="w-[320px] border-r border-border bg-background/70 backdrop-blur-sm flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <input
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Search rooms"
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
