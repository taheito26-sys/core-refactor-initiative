// ─── ConversationHeader — Unified Chat Platform ───────────────────────────
import { useMemo, useState, useCallback } from 'react';
import {
  Phone, Video, Search, ShieldCheck, Lock, Users,
  PanelLeftClose, PanelLeftOpen, MoreVertical,
  ArrowLeft, History, Info, BellOff, Trash2, Ban, Image as ImageIcon,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChatStore } from '@/lib/chat-store';
import { presenceOf } from '@/lib/chat-store';
import type { ChatRoomListItem, ChatRoomType } from '../types';
import { cn } from '@/lib/utils';

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
  onViewInfo?: () => void;
  onMuteToggle?: () => void;
  onClearChat?: () => void;
  isMuted?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────
export function ConversationHeader({
  room,
  meId,
  onToggleSidebar,
  sidebarOpen = true,
  onStartCall,
  onStartVideoCall,
  onToggleCallHistory,
  onSearchToggle,
  onViewInfo,
  onMuteToggle,
  onClearChat,
  isMuted = false,
}: Props) {
  const otherUserId = room.other_user_id ?? '';
  const presence    = useChatStore(presenceOf(otherUserId));
  const isMobile    = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

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

        {/* Voice call */}
        {onStartCall && (
          <button
            onClick={onStartCall}
            className="w-9 h-9 text-muted-foreground hover:text-primary hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
            title="Voice call"
          >
            <Phone size={16} />
          </button>
        )}

        {/* Video call */}
        {onStartVideoCall && (
          <button
            onClick={onStartVideoCall}
            className="w-9 h-9 text-muted-foreground hover:text-primary hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
            title="Video call"
          >
            <Video size={16} />
          </button>
        )}

        {/* Call history */}
        {onToggleCallHistory && (
          <button
            onClick={onToggleCallHistory}
            className="w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center"
            title="Call history"
          >
            <History size={16} />
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

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              'w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-all inline-flex items-center justify-center',
              menuOpen && 'text-foreground bg-accent',
            )}
            title="More options"
          >
            <MoreVertical size={18} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeMenu} />
              <div className="absolute top-full right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl p-1 min-w-[180px] z-50 animate-in fade-in-0 slide-in-from-top-2 duration-150">
                {onViewInfo && (
                  <button
                    onClick={() => { closeMenu(); onViewInfo(); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors text-foreground"
                  >
                    <Info size={15} className="text-muted-foreground" />
                    <span>Room info</span>
                  </button>
                )}
                {onSearchToggle && (
                  <button
                    onClick={() => { closeMenu(); onSearchToggle(); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors text-foreground"
                  >
                    <Search size={15} className="text-muted-foreground" />
                    <span>Search messages</span>
                  </button>
                )}
                {onMuteToggle && (
                  <button
                    onClick={() => { closeMenu(); onMuteToggle(); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors text-foreground"
                  >
                    <BellOff size={15} className="text-muted-foreground" />
                    <span>{isMuted ? 'Unmute' : 'Mute notifications'}</span>
                  </button>
                )}
                <button
                  onClick={closeMenu}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors text-foreground"
                >
                  <ImageIcon size={15} className="text-muted-foreground" />
                  <span>Media & files</span>
                </button>
                {onClearChat && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => { closeMenu(); onClearChat(); }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm hover:bg-destructive/10 transition-colors text-destructive"
                    >
                      <Trash2 size={15} />
                      <span>Clear chat</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
