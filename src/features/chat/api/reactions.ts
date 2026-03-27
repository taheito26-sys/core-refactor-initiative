import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function addReaction(roomId: string, messageId: string, reaction: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_add_reaction', {
      _room_id: roomId,
      _message_id: messageId,
      _reaction: reaction,
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function removeReaction(roomId: string, messageId: string, reaction: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_remove_reaction', {
      _room_id: roomId,
      _message_id: messageId,
      _reaction: reaction,
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function getMessageReactions(roomId: string): Promise<DeterministicResult<Array<{ message_id: string; user_id: string; reaction: string }>>> {
  try {
    const { data, error } = await (supabase as any)
      .from('message_reactions')
      .select('message_id, user_id, reaction')
      .eq('room_id', roomId);
    if (error) throw error;
    return ok((data ?? []) as unknown as Array<{ message_id: string; user_id: string; reaction: string }>);
  } catch (error) {
    return fail([], error);
  }
}
