// ─── ForwardMessageModal — Phase 12: Forward messages to other rooms ─────
import { useState, useMemo } from 'react';
import { X, Send, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage, ChatRoomListItem } from '../types';
import { resolveRoomDisplayName } from '../lib/identity';

interface Props {
  message: ChatMessage;
  rooms: ChatRoomListItem[];
  onForward: (messageId: string, targetRoomId: string) => void;
  onClose: () => void;
}

export function ForwardMessageModal({ message, rooms, onForward, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rooms.filter((r) =>
      resolveRoomDisplayName(r).toLowerCase().includes(q),
    );
  }, [rooms, search]);

  const roomName = (room: ChatRoomListItem) => resolveRoomDisplayName(room);

  const preview = message.content.length > 80 ? message.content.slice(0, 80) + '…' : message.content;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9999] animate-in fade-in-0 duration-150" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[340px] max-w-[90vw] bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Forward message</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message preview */}
        <div className="px-4 py-2 border-b border-border/50">
          <div className="px-3 py-2 rounded-lg bg-muted/50 border-l-[3px] border-primary/50">
            <p className="text-[11px] text-muted-foreground/70 truncate">{preview}</p>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
              autoFocus
            />
          </div>
        </div>

        {/* Room list */}
        <div className="max-h-[240px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">No rooms found</p>
          ) : (
            filtered.map((room) => (
              <button
                key={room.room_id}
                onClick={() => setSelected(room.room_id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  selected === room.room_id ? 'bg-primary/10' : 'hover:bg-muted/50',
                )}
              >
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                  selected === room.room_id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                  {roomName(room).slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-foreground truncate">
                  {roomName(room)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={() => {
              if (selected) {
                onForward(message.id, selected);
                onClose();
              }
            }}
            disabled={!selected}
            className={cn(
              'w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all',
              selected
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <Send className="h-4 w-4" />
            Forward
          </button>
        </div>
      </div>
    </>
  );
}
