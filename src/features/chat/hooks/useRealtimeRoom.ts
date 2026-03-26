import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useRealtimeRoom(roomId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!roomId) return;

    const roomChannel = supabase
      .channel(`room:${roomId}:events`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, () => {
        qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
        qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `room_id=eq.${roomId}` }, () => {
        qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_pins', filter: `room_id=eq.${roomId}` }, () => {
        qc.invalidateQueries({ queryKey: ['chat', 'pins', roomId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads', filter: `room_id=eq.${roomId}` }, () => {
        qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
        qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, qc]);
}
