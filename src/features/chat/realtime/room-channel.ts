import { supabase } from '@/integrations/supabase/client';

export function createRoomChannel(roomId: string, handlers: {
  onMessage?: () => void;
  onReaction?: () => void;
  onPin?: () => void;
  onRead?: () => void;
  onTyping?: () => void;
  onCallEvent?: () => void;
}) {
  return supabase
    .channel(`private-room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, () => handlers.onMessage?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `room_id=eq.${roomId}` }, () => handlers.onReaction?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_pins', filter: `room_id=eq.${roomId}` }, () => handlers.onPin?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads', filter: `room_id=eq.${roomId}` }, () => handlers.onRead?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'typing_presence', filter: `room_id=eq.${roomId}` }, () => handlers.onTyping?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'call_events', filter: `room_id=eq.${roomId}` }, () => handlers.onCallEvent?.());
}
