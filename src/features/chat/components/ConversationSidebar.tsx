import { useMemo } from 'react';
import type { ChatRoom } from '@/features/chat/lib/types';
import { Search, SlidersHorizontal, Mic, BarChart3, Forward, Reply, Clock } from 'lucide-react';
import { parseMsg, fmtListTime, getPalette } from '../lib/message-codec';
import { cn } from '@/lib/utils';

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
    <aside className={cn(
      isMobile ? 'w-full' : 'w-[280px]',
      "bg-slate-50/40 backdrop-blur-xl border-r border-slate-200 flex flex-col h-full overflow-hidden shrink-0 animate-in fade-in duration-700"
    )}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100/50 shrink-0">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center justify-between">
          Secure Inbox
          <SlidersHorizontal size={14} className="opacity-40" />
        </h2>
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search Trade Rooms..."
            className="w-full bg-white/60 border border-slate-200 rounded-xl py-2.5 pl-10 pr-3 text-[12px] font-bold text-slate-700 placeholder:text-slate-400 outline-none focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/5 transition-all"
          />
        </div>
      </div>

      {/* Room list */}
      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {normalizedRooms.map((room) => {
          const isActive = activeRoomId && String(activeRoomId) === String(room.room_id);
          const palette = getPalette(room.title || 'R');
          const preview = previewText(room.last_message_body || '');
          const timeLabel = room.last_message_at ? fmtListTime(room.last_message_at) : '';

          return (
            <button
              key={room.room_id}
              onClick={() => onSelectRoom?.(String(room.room_id))}
              className={cn(
                "w-full group flex items-start gap-3 p-4 transition-all duration-300 text-left relative border-l-4",
                isActive
                  ? "bg-white border-indigo-600 shadow-sm"
                  : "border-transparent hover:bg-white/40 hover:border-slate-100"
              )}
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
                  <div className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[9px] font-black min-w-[18px] h-[18px] flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                    {room.unread_count > 99 ? '99+' : room.unread_count}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className={cn(
                    "text-[14px] font-bold truncate",
                    isActive ? "text-slate-900" : "text-slate-600"
                  )}>
                    {room.title}
                  </span>
                  {timeLabel && (
                    <span className={cn(
                      "text-[10px] font-bold shrink-0 ml-2 tabular-nums",
                      room.unread_count > 0 ? "text-indigo-600" : "text-slate-400"
                    )}>
                      {timeLabel}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[12px] leading-tight text-slate-400 font-medium truncate">
                  {preview.icon}
                  <span className="truncate">{preview.text}</span>
                </div>
              </div>
            </button>
          );
        })}

        {normalizedRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-300">
            <Search size={32} className="mb-3 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-50">Locked Inbox Empty</p>
          </div>
        )}
      </div>
    </aside>
  );
}
