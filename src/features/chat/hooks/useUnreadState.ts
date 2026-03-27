import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useUnreadState(roomId: string | null) {
  const { data } = useQuery({
    queryKey: ['os-unread', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('os_get_unread_counts' as any);
      if (error) return [];
      return (data ?? []) as Array<{ room_id: string; unread_count: number }>;
    },
    staleTime: 10_000,
  });

  const roomUnreadCount = useMemo(() => {
    if (!data || !roomId) return 0;
    const entry = data.find((d: any) => d.room_id === roomId);
    return entry?.unread_count ?? 0;
  }, [data, roomId]);

  return { roomUnreadCount, firstUnreadMessageId: null };
}
