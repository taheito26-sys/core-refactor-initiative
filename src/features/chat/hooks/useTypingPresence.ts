import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useTypingPresence(roomId: string | null) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase.channel(`room:${roomId}:presence`);
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users = Object.values(state)
          .flat()
          .filter((p: any) => p.is_typing)
          .map((p: any) => p.user_id);
        setTypingUsers(Array.from(new Set(users)));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const updateTyping = {
    mutate: async (isTyping: boolean) => {
      if (!channelRef.current) return;
      const user = await supabase.auth.getUser();
      if (!user.data.user) return;

      await channelRef.current.track({
        user_id: user.data.user.id,
        is_typing: isTyping,
        at: new Date().toISOString(),
      });
    }
  };

  return { typingUsers, updateTyping };
}
