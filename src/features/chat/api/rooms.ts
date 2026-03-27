import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRooms(): Promise<DeterministicResult<any[]>> {
  try {
    // Standard OS UI expects 'chat_room_summary_v'
    const { data, error } = await supabase
      .from('chat_room_summary_v')
      .select('*')
      .order('last_message_at', { ascending: false });
    
    if (error) {
      // Fallback to table if view missing
      console.warn('chat_room_summary_v missing, falling back to os_rooms');
      const { data: tableData, error: tableError } = await supabase
        .from('os_rooms')
        .select('*')
        .order('last_message_at', { ascending: false });
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
        name: input.title, // Standardized column name
        type: input.type || 'standard',
        lane: input.lane || 'Personal',
        order_id: input.orderId
      })
      .select()
      .single();
    if (error) throw error;
    return ok(data);
  } catch (error) {
    return fail(null, error);
  }
}
