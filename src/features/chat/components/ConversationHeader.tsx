// ─── ConversationHeader — Unified Chat Platform ───────────────────────────
import { useMemo } from 'react';
import {
  Phone, Video, Search, ShieldCheck, Lock, Users,
  PanelLeftClose, PanelLeftOpen, MoreHorizontal,
  ArrowLeft, History,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChatStore } from '@/lib/chat-store';
import { presenceOf } from '@/lib/chat-store';
import type { ChatRoomListItem, ChatRoomType } from '../types';

// ── helpers ────────────────────────────────────────────────────────────────
function roomTypeIcon(type: ChatRoomType) {
  switch (type) {
    case 'merchant_private': return <Lock size={11} className="text-primary/70 shrink-0" />;
    case 'merchant_client':  return <ShieldCheck size={11} className="text-emerald-500/80 shrink-0" />;
    case 'merchant_collab':  return <Users size={11} className="text-amber-500/80 shrink-0" />;
  }
}

function roomTypeLabel(type: ChatRoomType): string {
  switch (type) {
    case 'merchant_private': return 'End-to-end encrypted';
    case 'merchant_client':  return 'Secure business chat';
    case 'merchant_collab':  return 'Merchants Hub';
  }
}

function presenceDot(status: 'online' | 'away' | 'offline') {
  const colour =
    status === 'online' ? 'bg-emerald-500' :
    status === 'away'   ? 'bg-amber-400'   :
                          'bg-muted-foreground/40';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${colour} border-2 border-background rounded-full shadow-sm`}
    />
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  room: ChatRoomListItem;
  meId: string;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onStartCall?: () => void;
  onStartVideoCall?: () => void;
  onToggleCallHistory?: () => void;
  onSearchToggle?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────
export function ConversationHeader({
  room,
  meId,
  onToggleSidebar,
  sidebarOpen = true,
  onStartCall,
  onSearchToggle,
}: Props) {
  const otherUserId = room.other_user_id ?? '';
  const presence    = useChatStore(presenceOf(otherUserId));
  const isMobile    = useIsMobile();

  const displayName = useMemo(
    () => room.display_name ?? room.name ?? (room.is_direct ? 'Direct Message' : 'Room'),
    [room.display_name, room.name, room.is_direct],
  );

  const avatarUrl = room.display_avatar ?? room.avatar_url;

  return (
    <header className="h-[54px] border-b border-border flex items-center justify-between px-3 md:px-4 bg-background/80 backdrop-blur-md shrink-0 relative z-30 gap-2">

      {/* ── Left: toggle/back + avatar + name ────────────────────────────── */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">

        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="w-9 h-9 -ml-1 text-muted-foreground hover:text-foreground transition-colors shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-accent"
            title={isMobile ? 'Back' : sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {isMobile
              ? <ArrowLeft size={20} />
              : sidebarOpen
                ? <PanelLeftClose size={18} />
                : <PanelLeftOpen  size={18} />
            }
          </button>
        )}

        {/* Avatar */}
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-9 h-9 rounded-xl object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-black shadow-lg shadow-primary/20 select-none">
              {initials(displayName)}
            </div>
          )}
          {room.is_direct && presenceDot(presence)}
        </div>

        {/* Name + subtitle */}
        <div className="flex flex-col min-w-0">
          <h2 className="text-[13px] font-black text-foreground truncate tracking-tight flex items-center gap-1.5">
            {displayName}
            {roomTypeIcon(room.room_type)}
          </h2>
          <div className="flex items-center gap-1.5 overflow-hidden">
            {room.is_direct ? (
              <span className={`text-[10px] font-semibold whitespace-nowrap ${
                presence === 'online' ? 'text-emerald-500' :
                presence === 'away'   ? 'text-amber-400'   :
                                        'text-muted-foreground'
              }`}>
                {presence === 'online' ? 'Active now' :
                 presence === 'away'   ? 'Away'        :
                                        'Offline'}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground font-medium truncate">
                {room.member_count} member{room.member_count !== 1 ? 's' : ''}
              </span>
            )}
            <span className="text-[9px] text-border hidden sm:inline">•</span>
            <span className="text-[9px] text-muted-foreground font-medium truncate hidden sm:inline">
              {roomTypeLabel(room.room_type)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Right: actions ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">

        {/* Voice call — only for merchant_private rooms */}
        {onStartCall && (
          <button
            onClick={onStartCall}
            className="w-9 h-9 text-muted-foreground hover:text-primary hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
            title="Voice call"
          >
            <Phone size={16} />
          </button>
        )}

        {/* Search */}
        {onSearchToggle && (
          <button
            onClick={onSearchToggle}
            className="w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
            title="Search messages"
          >
            <Search size={16} />
          </button>
        )}

        {/* More */}
        <button
          className="w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
          title="More options"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </header>
  );
}
