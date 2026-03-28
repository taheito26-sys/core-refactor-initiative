import { useMemo } from 'react';
import type { ChatRoom } from '@/features/chat/lib/types';
import { Search, SlidersHorizontal, Mic, BarChart3, Forward, Reply, Clock } from 'lucide-react';
import { parseMsg, fmtListTime, getPalette } from '../lib/message-codec';

interface Props {
  rooms?: ChatRoom[];
  conversations?: any[];
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
  currentUserId: string;
  isMobile?: boolean;
}

function previewText(raw: string): { icon?: React.ReactNode; text: string } {
  if (!raw) return { text: 'No messages yet' };
  const p = parseMsg(raw);
  if (p.isVoice) return { icon: <Mic size={12} className="shrink-0" />, text: `Voice · ${p.voiceDuration || 0}s` };
  if (p.isPoll) return { icon: <BarChart3 size={12} className="shrink-0" />, text: p.pollQuestion || 'Poll' };
  if (p.isFwd) return { icon: <Forward size={12} className="shrink-0" />, text: p.fwdText?.slice(0, 50) || 'Forwarded' };
  if (p.isReply) return { icon: <Reply size={12} className="shrink-0" />, text: p.text?.slice(0, 50) || 'Reply' };
  if (p.isScheduled) return { icon: <Clock size={12} className="shrink-0" />, text: p.text?.slice(0, 50) || 'Scheduled' };
  if (p.isSystemEvent) return { text: p.systemEventFields?.join(' · ') || 'System event' };
  return { text: p.text?.slice(0, 60) || 'No messages yet' };
}

export function ConversationSidebar({ rooms, conversations, activeRoomId, onSelectRoom, isMobile }: Props) {
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
    <aside className={`${isMobile ? 'w-full' : 'w-[260px]'} bg-background border-r border-border flex flex-col h-full overflow-hidden shrink-0`}>
      {/* Header */}
      <div className={`p-4 pb-2 shrink-0 ${isMobile ? 'pt-[max(16px,env(safe-area-inset-top,0px))]' : ''}`}>
        <h2 className="text-lg font-black text-foreground tracking-tight mb-3 flex items-center justify-between">
          Inbox
          <SlidersHorizontal size={16} className="text-muted-foreground/60 cursor-pointer hover:text-primary transition-colors" />
        </h2>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full bg-muted/60 border border-border/50 rounded-xl py-2.5 pl-9 pr-3 text-xs font-medium text-foreground placeholder:text-muted-foreground/60 outline-none focus:bg-background focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-all"
          />
        </div>

        <div className="flex gap-4 px-1 border-b border-border pb-2">
          <button className="relative text-xs font-bold text-foreground pb-1 group min-h-[36px] min-w-[44px]">
            ALL
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          </button>
          <button className="text-xs font-bold text-muted-foreground/60 pb-1 hover:text-foreground transition-colors min-h-[36px] min-w-[44px]">VIP</button>
        </div>
      </div>

      {/* Room list */}
      <div className={`flex-1 overflow-y-auto px-2 pt-2 space-y-1 ${isMobile ? 'pb-[max(12px,env(safe-area-inset-bottom,0px))]' : 'pb-6'}`}>
        {normalizedRooms.map((room) => {
          const isActive = activeRoomId && String(activeRoomId) === String(room.room_id);
          const palette = getPalette(room.title || 'R');
          const preview = previewText(room.last_message_body || '');
          const timeLabel = room.last_message_at ? fmtListTime(room.last_message_at) : '';

          return (
            <button
              key={room.room_id}
              onClick={() => onSelectRoom?.(String(room.room_id))}
              className={`w-full group flex items-start gap-3 rounded-2xl transition-all duration-200 text-left relative ${
                isActive
                  ? 'bg-primary/10 ring-1 ring-primary/20'
                  : 'hover:bg-muted/60'
              } ${isMobile ? 'p-3.5 min-h-[72px]' : 'p-3'}`}
            >
              {/* Avatar */}
              <div className="relative shrink-0 mt-0.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shadow-sm"
                  style={{ background: palette.bg, color: palette.text }}
                >
                  {room.title?.charAt(0).toUpperCase()}
                </div>
                {room.unread_count > 0 && (
                  <div className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[9px] font-black min-w-[18px] h-[18px] flex items-center justify-center rounded-full border-2 border-background shadow-sm">
                    {room.unread_count > 99 ? '99+' : room.unread_count}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[13px] font-bold truncate"
                    style={{ color: isActive ? undefined : palette.bg.includes('linear') ? undefined : palette.bg }}
                  >
                    <span className={isActive ? 'text-primary' : 'text-foreground'}>{room.title}</span>
                  </span>
                  {timeLabel && (
                    <span className={`text-[10px] font-medium shrink-0 ml-2 ${room.unread_count > 0 ? 'text-primary font-bold' : 'text-muted-foreground/60'}`}>
                      {timeLabel}
                    </span>
                  )}
                </div>

                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider block mb-1">
                  {room.type === 'deal' ? 'Secure Trade' : room.lane || 'Personal'}
                </span>

                <div className={`flex items-center gap-1.5 text-[11px] leading-tight ${room.unread_count > 0 ? 'text-foreground font-medium' : 'text-muted-foreground/70'}`}>
                  {preview.icon}
                  <span className="truncate">{preview.text}</span>
                </div>
              </div>
            </button>
          );
        })}

        {normalizedRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
            <Search size={32} className="mb-3" />
            <p className="text-xs font-medium">No conversations yet</p>
          </div>
        )}
      </div>
    </aside>
  );
}
