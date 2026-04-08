// ─── useRooms ──────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { getRooms } from '../api/chat';
import { useChatStore } from '@/lib/chat-store';

export const ROOMS_KEY = ['chat', 'rooms'];

export function useRooms() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const setRooms   = useChatStore((s) => s.setRooms);
  const bumpRoom   = useChatStore((s) => s.bumpRoom);
  const incUnread  = useChatStore((s) => s.incrementUnread);
  const activeRoom = useChatStore((s) => s.activeRoomId);

  const query = useQuery({
    queryKey: ROOMS_KEY,
    queryFn:  getRooms,
    enabled:  !!userId,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (query.data) setRooms(query.data);
  }, [query.data, setRooms]);

  // Realtime: new messages bump sidebar + unread badge
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
          if (msg.sender_id !== userId && msg.room_id !== activeRoom) {
            incUnread(msg.room_id);
          }
          qc.invalidateQueries({ queryKey: ROOMS_KEY });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc, bumpRoom, incUnread, activeRoom]);

  return query;
}
