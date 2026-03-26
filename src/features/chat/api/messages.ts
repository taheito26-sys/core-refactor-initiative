import { supabase } from '@/integrations/supabase/client';
import { ChatMessage, DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRoomMessages(roomId: string, limit = 100): Promise<DeterministicResult<ChatMessage[]>> {
  try {
    const { data, error } = await supabase
      .from('messages' as any)
      .select('*')
      .eq('room_id', roomId)
      .is('deleted_for_everyone_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return ok((data ?? []) as unknown as ChatMessage[]);
  } catch (error) {
    return fail([], error);
  }
}

export async function sendMessage(input: {
  roomId: string;
  body: string;
  bodyJson?: Record<string, unknown>;
  messageType?: string;
  clientNonce?: string;
  replyToMessageId?: string | null;
}): Promise<DeterministicResult<ChatMessage | null>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_send_message', {
      _room_id: input.roomId,
      _body: input.body,
      _body_json: input.bodyJson ?? {},
      _message_type: input.messageType ?? 'text',
      _client_nonce: input.clientNonce ?? null,
      _reply_to_message_id: input.replyToMessageId ?? null,
    });
    if (error) throw error;
    return ok((data ?? null) as ChatMessage | null);
  } catch (error) {
    return fail(null, error);
  }
}

export async function markRead(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_mark_read', { _room_id: roomId, _message_id: messageId });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function editMessage(messageId: string, body: string, bodyJson?: Record<string, unknown>): Promise<DeterministicResult<boolean>> {
  try {
    const { error } = await supabase
      .from('messages' as any)
      .update({ body, body_json: bodyJson ?? {}, message_type: 'edited' })
      .eq('id', messageId);
    if (error) throw error;
    return ok(true);
  } catch (error) {
    return fail(false, error);
  }
}

export async function deleteMessageForEveryone(messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { error } = await supabase
      .from('messages' as any)
      .update({ deleted_for_everyone_at: new Date().toISOString(), body: '', body_json: { deleted: true }, status: 'deleted' })
      .eq('id', messageId);
    if (error) throw error;
    return ok(true);
  } catch (error) {
    return fail(false, error);
  }
}

export async function deleteMessageForMe(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const user = await supabase.auth.getUser();
    const userId = user.data.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const { error } = await supabase.from('message_reads' as any).upsert({
      room_id: roomId,
      message_id: messageId,
      user_id: userId,
      read_at: new Date().toISOString(),
    }, { onConflict: 'message_id,user_id' } as any);
    if (error) throw error;
    return ok(true);
  } catch (error) {
    return fail(false, error);
  }
}

export async function scheduleMessage(input: {
  roomId: string;
  body: string;
  runAt: string;
  bodyJson?: Record<string, unknown>;
  clientNonce?: string;
}): Promise<DeterministicResult<boolean>> {
  try {
    const user = await supabase.auth.getUser();
    const senderId = user.data.user?.id;
    if (!senderId) throw new Error('Not authenticated');

    const { error } = await supabase.from('chat_scheduled_messages' as any).insert({
      room_id: input.roomId,
      sender_id: senderId,
      body: input.body,
      body_json: input.bodyJson ?? {},
      run_at: input.runAt,
      status: 'pending',
      client_nonce: input.clientNonce ?? null,
      message_type: 'scheduled',
    });
    if (error) throw error;
    return ok(true);
  } catch (error) {
    return fail(false, error);
  }
}
