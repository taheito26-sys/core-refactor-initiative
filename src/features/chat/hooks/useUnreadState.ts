import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useUnreadState(roomId: string | null) {
  const { data: unreadRows } = useQuery({
    queryKey: ['os-unread', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('os_get_unread_counts' as any);
      if (error) return [];
      return (data ?? []) as Array<{ room_id: string; unread_count: number }>;
    },
    staleTime: 10_000,
  });

  const { data: roomMessages } = useQuery({
    queryKey: ['os-unread-first-message', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('os_messages')
        .select('id,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 10_000,
  });

  const roomUnreadCount = useMemo(() => {
    if (!unreadRows || !roomId) return 0;
    const entry = unreadRows.find((d: any) => d.room_id === roomId);
    return entry?.unread_count ?? 0;
  }, [unreadRows, roomId]);

  const firstUnreadMessageId = useMemo(() => {
    if (!roomMessages?.length || roomUnreadCount <= 0) return null;
    const firstUnreadIndex = Math.max(0, roomMessages.length - roomUnreadCount);
    return roomMessages[firstUnreadIndex]?.id ?? null;
  }, [roomMessages, roomUnreadCount]);

  return { roomUnreadCount, firstUnreadMessageId };
}
