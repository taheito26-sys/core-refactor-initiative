// ─── ConversationSidebar — All 40 UX phases ──────────────────────────────
import { useState, useMemo, useCallback, useRef } from 'react';
import { Search, Plus, Users, Lock, Briefcase, RefreshCw, Pin, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore, typingUsersInRoom } from '@/lib/chat-store';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme-context';
import type { ChatRoomListItem, ChatRoomType } from '../types';
import { Button } from '@/components/ui/button';

interface Props {
  rooms:        ChatRoomListItem[];
  activeRoomId: string | null;
  onSelectRoom: (id: string) => void;
  onNewChat:    () => void;
  isLoading:    boolean;
  meId:         string;
}

const TYPE_ICONS: Record<ChatRoomType, React.ElementType> = {
  merchant_private: Lock,
  merchant_client:  Briefcase,
  merchant_collab:  Users,
};

// Phase 38: Avatar gradient from user ID hash
function avatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 65% 55%), hsl(${h2} 60% 45%))`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// Phase 14: Smart preview
function smartPreview(preview: string, type?: string): string {
  if (!preview) return '';
  if (preview.startsWith('🖼')) return '📷 Photo';
  if (preview.startsWith('🎙')) return '🎤 Voice message';
  if (preview.startsWith('📎')) return preview;
  return preview.length > 45 ? preview.slice(0, 45) + '…' : preview;
}

type Filter = 'all' | ChatRoomType;

export function ConversationSidebar({ rooms, activeRoomId, onSelectRoom, onNewChat, isLoading, meId }: Props) {
  const t = useT();
  const { settings } = useTheme();
  const isRTL = settings.language === 'ar';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  // Phase 12: Pinned conversations
  const { pinned, unpinned } = useMemo(() => {
    let list = rooms;
    if (filter !== 'all') list = list.filter((r) => r.room_type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.name ?? r.display_name ?? '').toLowerCase().includes(q) ||
        (r.last_message_preview ?? '').toLowerCase().includes(q),
      );
    }
    const p = list.filter((r) => r.is_pinned);
    const u = list.filter((r) => !r.is_pinned);
    return { pinned: p, unpinned: u };
  }, [rooms, filter, search]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="flex flex-col w-72 lg:w-80 border-r border-border/50 bg-card h-full shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-sm text-foreground">Messages</h2>
            {totalUnread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-primary-foreground px-1.5 animate-in zoom-in-50 duration-200">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
            {isLoading && <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-accent" onClick={onNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Phase 17: Search-as-you-type */}
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isRTL ? '...بحث في المحادثات' : 'Search conversations...'}
            className="w-full ps-8 pe-3 py-1.5 text-xs rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40 transition-shadow"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-2">
          {(['all', 'merchant_private', 'merchant_client', 'merchant_collab'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 text-[9px] font-bold py-1 rounded-md transition-all',
                filter === f
                  ? 'bg-primary text-primary-foreground shadow-sm'
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
        {pinned.length === 0 && unpinned.length === 0 ? (
          /* Phase 18: Empty state illustration */
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 px-8">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <MessageCircle className="h-8 w-8 text-primary/40" />
            </div>
            <p className="text-xs font-semibold text-center">
              {search ? 'No conversations found' : 'No conversations yet'}
            </p>
            <p className="text-[10px] text-muted-foreground/60 text-center">
              {search ? 'Try a different search term' : 'Start a new conversation to begin messaging'}
            </p>
          </div>
        ) : (
          <>
            {/* Phase 12: Pinned section */}
            {pinned.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-4 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">
                  <Pin className="h-2.5 w-2.5" />
                  Pinned
                </div>
                {pinned.map((room) => (
                  <RoomRow
                    key={room.room_id}
                    room={room}
                    isActive={room.room_id === activeRoomId}
                    unread={unreadCounts[room.room_id] ?? room.unread_count}
                    onClick={() => onSelectRoom(room.room_id)}
                    meId={meId}
                  />
                ))}
                <div className="h-px bg-border/30 mx-4 my-1" />
              </>
            )}
            {unpinned.map((room) => (
              <RoomRow
                key={room.room_id}
                room={room}
                isActive={room.room_id === activeRoomId}
                unread={unreadCounts[room.room_id] ?? room.unread_count}
                onClick={() => onSelectRoom(room.room_id)}
                meId={meId}
              />
            ))}
          </>
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
  const displayName = room.display_name ?? room.name ?? 'Unnamed room';
  const preview = smartPreview(room.last_message_preview ?? '');
  const timeStr = room.last_message_at
    ? new Date(room.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Phase 13: Presence status ring
  const presence = useChatStore((s) => room.other_user_id ? s.presenceByUser[room.other_user_id] : undefined);
  const isOnline = presence === 'online';
  const isAway = presence === 'away';

  // Phase 15: Typing preview in list
  const typingUsers = useChatStore(typingUsersInRoom(room.room_id));
  const isTyping = typingUsers.length > 0;

  // Phase 11: Swipe actions (touch gesture)
  const touchStartX = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < -10) setSwipeOffset(Math.max(-80, dx));
    else setSwipeOffset(0);
  }, []);
  const handleTouchEnd = useCallback(() => {
    setSwipeOffset(0);
  }, []);

  return (
    <button
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-start transition-all border-b border-border/20 relative overflow-hidden',
        isActive
          ? 'bg-primary/10 border-s-2 border-s-primary'
          : 'hover:bg-muted/50 border-s-2 border-s-transparent',
      )}
      style={{ transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 0.2s ease' : 'none' }}
    >
      {/* Phase 13: Avatar with presence ring */}
      <div className="relative shrink-0">
        {room.display_avatar ? (
          <div className={cn(
            'rounded-full p-[2px]',
            isOnline ? 'ring-2 ring-emerald-500' : isAway ? 'ring-2 ring-amber-400' : '',
          )}>
            <img
              src={room.display_avatar}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          </div>
        ) : (
          <div className={cn(
            'rounded-full p-[2px]',
            isOnline ? 'ring-2 ring-emerald-500' : isAway ? 'ring-2 ring-amber-400' : '',
          )}>
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
              style={{ background: avatarGradient(room.room_id) }}
            >
              {initials(displayName)}
            </div>
          </div>
        )}
        {/* Online dot */}
        {isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cn(
            'text-xs truncate',
            unread > 0 ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground',
          )}>
            {displayName}
          </span>
          <div className="flex items-center gap-1.5 shrink-0 ms-2">
            {room.is_muted && (
              <span className="text-muted-foreground/40 text-[9px]">🔇</span>
            )}
            <span className={cn(
              'text-[9px]',
              unread > 0 ? 'text-primary font-semibold' : 'text-muted-foreground/50',
            )}>{timeStr}</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className={cn(
            'text-[11px] truncate max-w-[160px]',
            isTyping ? 'text-primary font-medium italic' : 'text-muted-foreground/70',
          )}>
            {/* Phase 15: Typing preview replaces last message */}
            {isTyping ? 'typing...' : preview || <span className="italic">No messages yet</span>}
          </p>
          {/* Phase 16: Unread count pill redesign */}
          {unread > 0 && (
            <span className={cn(
              'flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[9px] font-black px-1 shrink-0 ms-1',
              room.is_muted
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground',
            )}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
