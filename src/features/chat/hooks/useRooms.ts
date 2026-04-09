// ─── useRooms ──────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { getRooms } from '../api/chat';
import { useChatStore } from '@/lib/chat-store';
import type { ChatRoomListItem } from '../types';
import { resolveRoomAvatar, resolveRoomDisplayName } from '../lib/identity';

export const ROOMS_KEY = ['chat', 'rooms'];

/** Client-side enrichment: populate display_name / display_avatar from
 *  what the RPC returns so the sidebar always has names to show. */
function enrichRooms(rooms: ChatRoomListItem[]): ChatRoomListItem[] {
  return rooms.map((r) => ({
    ...r,
    display_name: resolveRoomDisplayName(r),
    display_avatar: resolveRoomAvatar(r),
  }));
}

export function useRooms() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const setRooms   = useChatStore((s) => s.setRooms);
  const bumpRoom   = useChatStore((s) => s.bumpRoom);
  const incUnread  = useChatStore((s) => s.incrementUnread);
  const activeRoom = useChatStore((s) => s.activeRoomId);

  const query = useQuery({
    queryKey: ROOMS_KEY,
    queryFn:  async () => enrichRooms(await getRooms()),
    enabled:  !!userId,
    staleTime: 20_000,
  });

  // Keep the Zustand store in sync so the sidebar re-renders on data change
  useEffect(() => {
    if (query.data) setRooms(query.data);
  }, [query.data, setRooms]);

  // Keep activeRoom in a ref so the realtime callback can read the latest
  // value without being in the dependency array (avoids re-subscribing on
  // every room click, which briefly creates two listeners and doubles events).
  const activeRoomRef = useRef<string | null>(activeRoom);
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

  // Realtime: new messages bump sidebar + unread badge
  // Only depends on userId — stable for the lifetime of the session.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`chat-rooms-rt-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = payload.new as any;
          if (!msg?.room_id) return;
          bumpRoom(msg.room_id, (msg.content ?? '').slice(0, 80), msg.created_at);
          if (msg.sender_id !== userId && msg.room_id !== activeRoomRef.current) {
            incUnread(msg.room_id);
          }
          // Re-fetch rooms list so preview text & last_message_at stay fresh
          qc.invalidateQueries({ queryKey: ROOMS_KEY });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]); // intentionally omit activeRoom — use ref above

  return query;
}
