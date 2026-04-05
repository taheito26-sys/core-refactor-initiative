import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

/**
 * Fetches messages for a room.
 *
 * ROOT CAUSE FIX (BLACK WINDOW): the previous query used
 *   sender:merchant_profiles!os_messages_sender_merchant_id_fkey(...)
 * which requires the FK constraint "os_messages_sender_merchant_id_fkey" to
 * exist in the Supabase schema.  If the constraint is absent, Supabase returns
 * an error ("Could not find a relationship") which propagated to fail([],…),
 * the queryFn threw, and messages.data stayed undefined → empty MessageList →
 * the chat window appeared completely black.
 *
 * Fix: remove the FK join entirely.  sender_name is derived from
 * sender_merchant_id.  Sender display names can be enriched in a non-blocking
 * secondary query if needed in future.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRoomMessages(roomId: string, limit = 100): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('os_messages')
      .select('*')                       // ← was: select('*,sender:merchant_profiles!fk…')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok((data ?? []).map((m: any) => ({
      ...m,
      body: m.content,
      sender_name: m.sender_merchant_id,   // display name enrichment removed (was causing the FK error)
    })));
  } catch (error) {
    return fail([], error);
  }
}

/**
 * Sends a message via the secure idempotent RPC.
 * ⚠️ BACKEND REQUIRED: fn_chat_send_message RPC must exist in Supabase.
 */
export async function sendMessage(input: {
  roomId: string;
  body: string;
  bodyJson?: Record<string, unknown>;
  messageType?: string;
  clientNonce?: string;
  replyToMessageId?: string | null;
  expiresAt?: string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<DeterministicResult<any | null>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_send_message', {
      _room_id: input.roomId,
      _body: input.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _body_json: (input.bodyJson ?? {}) as any,
      _message_type: input.messageType ?? 'text',
      _client_nonce: input.clientNonce ?? null,
      _reply_to_message_id: input.replyToMessageId ?? null,
      _expires_at: input.expiresAt ?? null,
    });

    if (error) throw error;
    return ok(data ?? null);
  } catch (error) {
    return fail(null, error);
  }
}

/**
 * Marks messages as read up to a specific message ID.
 * ⚠️ BACKEND REQUIRED: fn_chat_mark_read RPC must exist in Supabase.
 */
export async function markMessagesReadUpTo(roomId: string, messageId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await supabase.rpc('fn_chat_mark_read', {
      _room_id: roomId,
      _message_id: messageId,
    });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}
