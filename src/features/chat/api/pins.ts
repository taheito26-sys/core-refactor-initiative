import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function pinMessage(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_pin_message', {
      _room_id: roomId,
      _message_id: messageId,
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function unpinMessage(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_unpin_message', {
      _room_id: roomId,
      _message_id: messageId,
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function getPinnedMessages(roomId: string): Promise<DeterministicResult<Array<{ message_id: string; pinned_at: string; pinned_by: string }>>> {
  try {
    const { data, error } = await supabase
      .from('message_pins' as any)
      .select('message_id, pinned_at, pinned_by')
      .eq('room_id', roomId)
      .is('unpinned_at', null)
      .order('pinned_at', { ascending: false });
    if (error) throw error;
    return ok((data ?? []) as unknown as Array<{ message_id: string; pinned_at: string; pinned_by: string }>);
  } catch (error) {
    return fail([], error);
  }
}
