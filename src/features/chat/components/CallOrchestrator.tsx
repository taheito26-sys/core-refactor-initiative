import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  roomId: string | null;
}

export function CallOrchestrator({ roomId }: Props) {
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`room:${roomId}:calls`);
    channel
      .on('broadcast', { event: 'offer' }, (payload) => {
        console.log('[CallOrchestrator] Incoming call offer:', payload);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  return null;
}
