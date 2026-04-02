import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok, ChatRoom } from '@/features/chat/lib/types';

export async function getRooms(): Promise<DeterministicResult<ChatRoom[]>> {
  try {
    // We query the new room summary view which handles unread counts and last messages
    const { data, error } = await supabase
      .from('chat_room_summary_v' as any)
      .select('*')
      .order('last_message_at', { ascending: false });
    
    if (error) throw error;
    
    return ok((data ?? []).map(normalizeRoom));
  } catch (error) {
    return fail([], error);
  }
}

function normalizeRoom(r: any): ChatRoom {
  return {
    room_id: r.id,
    kind: r.type === 'standard' ? 'direct' : 'group',
    lane: (r.lane as any) || 'Personal',
    title: r.name || 'Secure Channel',
    relationship_id: r.relationship_id || null,
    member_role: r.member_role || 'member',
    unread_count: Number(r.unread_count || 0),
    last_message_id: r.last_message_id || null,
    last_message_body: r.last_message_content || '',
    last_message_at: r.last_message_at || null,
    updated_at: r.updated_at || new Date().toISOString(),
    security_policies: r.security_policies,
    retention_policy: r.retention_policy,
    type: r.type,
  };
}

export async function createRoom(input: {
  name: string;
  type: string;
  lane: string;
  members: string[];
}): Promise<DeterministicResult<string | null>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_create_room', {
      _name: input.name,
      _type: input.type,
      _lane: input.lane,
      _member_merchant_ids: input.members
    });
    if (error) throw error;
    return ok(data as string);
  } catch (error) {
    return fail(null, error);
  }
}