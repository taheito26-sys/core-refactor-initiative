import { supabase } from '@/integrations/supabase/client';
import { ChatCallSession, DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function startCall(roomId: string): Promise<DeterministicResult<ChatCallSession | null>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_start_call', { _room_id: roomId });
    if (error) throw error;
    return ok((data ?? null) as unknown as ChatCallSession | null);
  } catch (error) {
    return fail(null, error);
  }
}

export async function joinCall(callSessionId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_join_call', { _call_session_id: callSessionId });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function leaveCall(callSessionId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_leave_call', { _call_session_id: callSessionId });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function endCall(callSessionId: string): Promise<DeterministicResult<boolean>> {
  try {
    const { data, error } = await (supabase.rpc as any)('fn_chat_end_call', { _call_session_id: callSessionId });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (error) {
    return fail(false, error);
  }
}

export async function getCallHistory(roomId: string): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('call_history_v' as any)
      .select('*')
      .eq('room_id', roomId)
      .order('started_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok((data ?? []) as any[]);
  } catch (error) {
    return fail([], error);
  }
}
