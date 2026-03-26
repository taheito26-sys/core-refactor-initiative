import { useMemo, useState } from 'react';
import type { ChatRoom } from '@/features/chat/lib/types';
import { Search, MessageSquareText } from 'lucide-react';
import { fmtListTime, parseMsg } from '@/features/chat/lib/message-codec';

interface Props {
  rooms?: ChatRoom[];
  conversations?: Array<any>;
  currentUserId?: string;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

export function ConversationSidebar({ rooms, conversations, activeRoomId, onSelectRoom }: Props) {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<'all' | 'unread' | 'muted'>('all');

  const normalizedRooms = useMemo(() => {
    if (rooms && rooms.length) return rooms;
    return (conversations ?? []).map((c) => ({
      room_id: c.relationship_id,
      title: c.counterparty_name ?? c.counterparty_nickname ?? 'Room',
      unread_count: c.unread_count ?? 0,
      last_message_body: c.last_message ?? '',
    })) as ChatRoom[];
  }, [rooms, conversations]);

  const unreadCount = useMemo(
    () => normalizedRooms.filter((room) => Number(room.unread_count) > 0).length,
    [normalizedRooms]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const byFolder = normalizedRooms.filter((room) => {
      if (folder === 'all') return true;
      if (folder === 'unread') return Number(room.unread_count) > 0;
      return false;
    });
    if (!term) return byFolder;
    return byFolder.filter((room) => (room.title ?? '').toLowerCase().includes(term));
  }, [folder, q, normalizedRooms]);

  const initials = (title?: string | null) => {
    const clean = (title ?? '').trim();
    if (!clean) return 'C';
    const parts = clean.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
  };

  const previewText = (raw?: string | null) => {
    if (!raw) return 'No messages';
    const parsed = parseMsg(raw);
    if (parsed.isVoice) return 'Voice message';
    if (parsed.isPoll) return 'Poll';
    if (parsed.isSystemEvent) return 'System event';
    return parsed.text || 'No messages';
  };

  return (
    <aside className="w-[360px] max-w-[42vw] min-w-[300px] border-r border-border bg-card/95 flex flex-col">
      <div className="p-4 border-b border-border/70">
        <h2 className="text-[30px] font-bold leading-none tracking-tight">All Conversations</h2>
        <div className="mt-4 flex gap-4 border-b border-border/80">
          <button
            onClick={() => setFolder('all')}
            className={`pb-2 text-sm font-semibold border-b-2 ${
              folder === 'all' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFolder('unread')}
            className={`pb-2 text-sm font-semibold border-b-2 ${
              folder === 'unread' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent'
            }`}
          >
            Unread{unreadCount ? ` (${unreadCount})` : ''}
          </button>
          <button
            onClick={() => setFolder('muted')}
            className={`pb-2 text-sm font-semibold border-b-2 ${
              folder === 'muted' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent'
            }`}
          >
            Muted
          </button>
        </div>
        <div className="mt-3 relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <input
            className="w-full rounded-full border border-input/90 bg-background px-10 py-2.5 text-sm"
            placeholder="Search conversations..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="overflow-auto flex-1 divide-y divide-border/50">
        {filtered.length === 0 ? (
          <div className="h-full min-h-[220px] grid place-items-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <MessageSquareText className="h-6 w-6 opacity-50" />
              <span>No conversations</span>
            </div>
          </div>
        ) : filtered.map((room) => {
          const title = room.title || 'Untitled Room';
          const hasUnread = Number(room.unread_count) > 0;
          const preview = previewText(room.last_message_body);
          return (
            <button
              key={room.room_id}
              onClick={() => onSelectRoom?.(room.room_id)}
              className={`w-full text-left px-5 py-4 hover:bg-muted/50 transition ${
                activeRoomId === room.room_id ? 'bg-primary/5' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold shrink-0">
                  {initials(title)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[27px] leading-none tracking-tight truncate">{title}</p>
                    {hasUnread && (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">
                        {room.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <p className={`text-sm truncate ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {preview}
                    </p>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {room.last_message_at ? fmtListTime(room.last_message_at) : ''}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
