import { useState, useMemo } from 'react';
import { Search, Plus, Users, Lock, Briefcase, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/lib/chat-store';
import { useT } from '@/lib/i18n';
import type { ChatRoomListItem, ChatRoomType } from '../types';
import { Button } from '@/components/ui/button';

interface Props {
  rooms:        ChatRoomListItem[];
  activeRoomId: string | null;
  onSelectRoom: (id: string) => void;
  isLoading:    boolean;
  meId:         string;
}

const TYPE_ICONS: Record<ChatRoomType, React.ElementType> = {
  merchant_private: Lock,
  merchant_client:  Briefcase,
  merchant_collab:  Users,
};

const TYPE_COLORS: Record<ChatRoomType, string> = {
  merchant_private: 'text-violet-500',
  merchant_client:  'text-blue-500',
  merchant_collab:  'text-emerald-500',
};

type Filter = 'all' | ChatRoomType;

export function ConversationSidebar({ rooms, activeRoomId, onSelectRoom, isLoading, meId }: Props) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  const filtered = useMemo(() => {
    let list = rooms;
    if (filter !== 'all') list = list.filter((r) => r.room_type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.name ?? r.display_name ?? '').toLowerCase().includes(q) ||
        (r.last_message_preview ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [rooms, filter, search]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col w-72 lg:w-80 border-r border-border/50 bg-card h-full shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-sm text-foreground">Messages</h2>
            {totalUnread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-[9px] font-black text-white px-1">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
            {isLoading && <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-2">
          {(['all', 'merchant_private', 'merchant_client', 'merchant_collab'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 text-[9px] font-bold py-1 rounded-md transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {f === 'all' ? 'All'
                : f === 'merchant_private' ? '🔒 P2P'
                : f === 'merchant_client'  ? '💼 Client'
                : '👥 Hub'}
            </button>
          ))}
        </div>
      </div>

      {/* Room list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <p className="text-xs font-medium">
              {search ? 'No results' : 'No conversations'}
            </p>
          </div>
        ) : (
          filtered.map((room) => (
            <RoomRow
              key={room.room_id}
              room={room}
              isActive={room.room_id === activeRoomId}
              unread={unreadCounts[room.room_id] ?? room.unread_count}
              onClick={() => onSelectRoom(room.room_id)}
              meId={meId}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RoomRow({
  room, isActive, unread, onClick, meId,
}: {
  room: ChatRoomListItem;
  isActive: boolean;
  unread: number;
  onClick: () => void;
  meId: string;
}) {
  const Icon = TYPE_ICONS[room.room_type];
  const iconColor = TYPE_COLORS[room.room_type];
  const displayName = room.display_name ?? room.name ?? 'Unnamed room';
  const preview = room.last_message_preview ?? '';
  const timeStr = room.last_message_at
    ? new Date(room.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/20',
        isActive
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-muted/50 border-l-2 border-l-transparent',
      )}
    >
      {/* Avatar / type icon */}
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        isActive ? 'bg-primary/20' : 'bg-muted',
      )}>
        {room.display_avatar ? (
          <img
            src={room.display_avatar}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <Icon className={cn('h-5 w-5', isActive ? 'text-primary' : iconColor)} />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cn(
            'text-xs font-semibold truncate',
            unread > 0 ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {displayName}
          </span>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {room.is_muted && (
              <span className="text-muted-foreground/40 text-[9px]">🔇</span>
            )}
            <span className="text-[9px] text-muted-foreground/50">{timeStr}</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-[11px] text-muted-foreground/70 truncate max-w-[160px]">
            {preview || <span className="italic">No messages yet</span>}
          </p>
          {unread > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-black text-white px-0.5 shrink-0 ml-1">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
