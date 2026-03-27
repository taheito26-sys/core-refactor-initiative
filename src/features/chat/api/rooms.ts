import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRooms(): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await (supabase as any)
      .from('chat_room_summary_v')
      .select('*')
      .order('last_message_at', { ascending: false });
    
    if (error) {
      console.warn('chat_room_summary_v missing, falling back to os_rooms');
      const { data: tableData, error: tableError } = await supabase
        .from('os_rooms')
        .select('*')
        .order('updated_at', { ascending: false });
      if (tableError) throw tableError;
      return ok((tableData ?? []).map(normalizeRoom));
    }
    
    return ok((data ?? []).map(normalizeRoom));
  } catch (error) {
    return fail([], error);
  }
}

function normalizeRoom(r: any) {
  return {
    ...r,
    room_id: r.id ?? r.room_id,
    title: r.name ?? r.title ?? 'Room',
    name: r.name ?? r.title ?? 'Room',
    last_message_body: r.last_message_content ?? r.last_message_body ?? '',
    unread_count: Number(r.unread_count ?? r.unread_messages ?? r.unread_total ?? 0),
    kind: r.type === 'standard' ? 'direct' : 'group',
    lane: r.lane ?? 'Personal',
    updated_at: r.last_message_at ?? r.updated_at ?? new Date().toISOString(),
  };
}

export async function createRoom(input: {
  title: string;
  type?: string;
  lane?: string;
  orderId?: string;
}): Promise<DeterministicResult<any | null>> {
  try {
    const { data, error } = await supabase
      .from('os_rooms')
      .insert({
        name: input.title,
        type: input.type || 'standard',
        lane: input.lane || 'Personal',
      })
      .select()
      .single();
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(null, error);
  }
}
