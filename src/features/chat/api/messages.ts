import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

/**
 * Fetches messages for a room with sender profile joins.
 */
export async function getRoomMessages(roomId: string, limit = 100): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('os_messages')
      .select(`
        *,
        sender:merchant_profiles!os_messages_sender_merchant_id_fkey(display_name, nickname)
      `)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);
      
    if (error) throw error;
    
    return ok((data ?? []).map((m: any) => ({
       ...m,
       body: m.content,
       sender_name: m.sender?.display_name || m.sender_merchant_id,
    })));
  } catch (error) {
    return fail([], error);
  }
}

/**
 * Sends a message via the secure idempotent RPC.
 */
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
    const { data, error } = await supabase.rpc('fn_chat_send_message', {
      _room_id: input.roomId,
      _body: input.body,
      _body_json: (input.bodyJson ?? {}) as any,
      _message_type: input.messageType ?? 'text',
      _client_nonce: input.clientNonce ?? null,
      _reply_to_message_id: input.replyToMessageId ?? null,
      _expires_at: input.expiresAt ?? null
    });
    
    if (error) throw error;
    return ok(data ?? null);
  } catch (error) {
    return fail(null, error);
  }
}

/**
 * Marks messages as read up to a specific message ID.
 */
export async function markMessagesReadUpTo(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_mark_read', { 
      _room_id: roomId, 
      _message_id: messageId 
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}