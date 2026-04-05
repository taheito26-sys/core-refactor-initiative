import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getRooms } from '@/features/chat/api/rooms';

/**
 * ISSUE 2 FIX: The hook previously had no real-time subscription of its own.
 * The only invalidation came from useRoomMessages, which only runs while a
 * specific room is open.  When the inbox is first opened (no room selected),
 * or when a brand-new message arrives in a background room while the user is
 * reading a different room, the sidebar unread counts and last-message previews
 * would never update until the 5-second staleTime expired.
 *
 * Fix: subscribe to os_messages INSERT events here so the sidebar always stays
 * live regardless of which room (if any) the user currently has open.
 */
export function useRooms() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('rooms-list-rt')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'os_messages' },
        () => {
          qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return useQuery({
    queryKey: ['chat', 'rooms'],
    queryFn: async () => {
      const res = await getRooms();
      if (!res.ok) throw new Error(res.error ?? 'Fetch failed');
      return res.data || [];
    },
    staleTime: 5000,
  });
}
