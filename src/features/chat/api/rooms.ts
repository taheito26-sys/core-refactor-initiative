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
      return ok(tableData ?? []);
    }
    
    return ok(data ?? []);
  } catch (error) {
    return fail([], error);
  }
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
