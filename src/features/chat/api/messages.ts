import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function getRoomMessages(roomId: string, limit = 100): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('os_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    
    return ok((data ?? []).map((m: any) => ({
       ...m,
       body: m.content || m.body || '',
       sender_id: m.sender_merchant_id || m.sender_id || 'unknown',
    })));
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
  expiresAt?: string | null;
}): Promise<DeterministicResult<any | null>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_send_message', {
      _room_id: input.roomId,
      _body: input.body,
      _body_json: input.bodyJson ?? {},
      _message_type: input.messageType ?? 'text',
      _client_nonce: input.clientNonce ?? null,
      _reply_to_message_id: input.replyToMessageId ?? null,
      _expires_at: input.expiresAt ?? null
    });
    if (error) throw error;
    if (data) {
      (data as any).body = (data as any).content;
      (data as any).sender_id = (data as any).sender_merchant_id;
    }
    return ok(data ?? null);
  } catch (error) {
    return fail(null, error);
  }
}

export async function markRead(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_mark_read', { 
      _room_id: roomId, 
      _message_id: messageId 
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}


export async function markMessagesReadUpTo(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  return markRead(roomId, messageId);
}
