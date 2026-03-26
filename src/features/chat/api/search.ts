import { supabase } from '@/integrations/supabase/client';
import { ChatSearchResult, DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function searchInRoom(roomId: string, query: string): Promise<DeterministicResult<ChatSearchResult[]>> {
  try {
    const { data, error } = await supabase
      .from('message_search_v' as any)
      .select('message_id, room_id, body, created_at, room_title, snippet')
      .eq('room_id', roomId)
      .ilike('body', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok((data ?? []) as ChatSearchResult[]);
  } catch (error) {
    return fail([], error);
  }
}

export async function globalSearch(query: string): Promise<DeterministicResult<ChatSearchResult[]>> {
  try {
    const { data, error } = await supabase
      .from('message_search_v' as any)
      .select('message_id, room_id, body, created_at, room_title, snippet')
      .ilike('body', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return ok((data ?? []) as ChatSearchResult[]);
  } catch (error) {
    return fail([], error);
  }
}
