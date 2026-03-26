import { supabase } from '@/integrations/supabase/client';
import { ChatRoom, DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRooms(): Promise<DeterministicResult<ChatRoom[]>> {
  try {
    const { data, error } = await supabase
      .from('chat_room_summary_v' as any)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ok((data ?? []) as ChatRoom[]);
  } catch (error) {
    return fail([], error);
  }
}

export async function createRoom(input: {
  title: string;
  kind?: 'direct' | 'group';
  userIds: string[];
}): Promise<DeterministicResult<{ roomId: string | null }>> {
  try {
    const user = await supabase.auth.getUser();
    const uid = user.data.user?.id;
    if (!uid) throw new Error('Not authenticated');

    const { data: room, error: roomError } = await supabase
      .from('chat_rooms' as any)
      .insert({
        title: input.title,
        kind: input.kind ?? 'group',
        owner_user_id: uid,
        created_by: uid,
      })
      .select('id')
      .single();
    if (roomError) throw roomError;

    const uniqueUsers = Array.from(new Set([uid, ...input.userIds]));
    const members = uniqueUsers.map((userId) => ({
      room_id: room.id,
      user_id: userId,
      role: userId === uid ? 'owner' : 'member',
    }));

    const { error: memberError } = await supabase.from('room_members' as any).insert(members);
    if (memberError) throw memberError;

    return ok({ roomId: room.id as string });
  } catch (error) {
    return fail({ roomId: null }, error);
  }
}

export async function getRoomMembers(roomId: string): Promise<DeterministicResult<Array<{ user_id: string; role: string }>>> {
  try {
    const { data, error } = await supabase
      .from('room_members' as any)
      .select('user_id, role, left_at')
      .eq('room_id', roomId)
      .is('left_at', null);
    if (error) throw error;
    return ok((data ?? []) as Array<{ user_id: string; role: string }>);
  } catch (error) {
    return fail([], error);
  }
}
