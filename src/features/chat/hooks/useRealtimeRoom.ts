import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useRealtimeRoom(roomId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!roomId) return;

    const roomChannel = (supabase
      .channel(`room:${roomId}:events`) as any)
      .on('presence', { event: 'sync' }, () => {
        const state = roomChannel.presenceState();
        qc.setQueryData(['chat', 'presence', roomId], state);
      })
      .on('presence', { event: 'join', key: '*' }, ({ newPresences }) => {
        qc.setQueryData(['chat', 'presence', roomId, 'online'], (old: any) => [...(old || []), ...newPresences]);
      })
      .on('presence', { event: 'leave', key: '*' }, ({ leftPresences }) => {
        qc.setQueryData(['chat', 'presence', roomId, 'online'], (old: any) => (old || []).filter((p: any) => !leftPresences.some((lp: any) => lp.at === p.at)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
        qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
        qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
        
        // Handle delivery receipts for incoming messages
        if (payload.eventType === 'INSERT' && (payload.new as any).sender_id !== supabase.auth.getUser()) {
          // Trigger delivery receipt mutation if needed
        }
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
