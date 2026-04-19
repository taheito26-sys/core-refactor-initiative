// ─── Call Session API ─────────────────────────────────────────────────────────
//
// Frontend client for the call-session edge function.
// Replaces direct RPC calls for call lifecycle with a unified endpoint
// that returns signaling credentials (URL + token) alongside call metadata.
//
// This is the new primary path for call setup. The old Postgres-row-based
// signaling (sdp_offer/sdp_answer/ice_candidates in chat_call_participants)
// is retained only as a temporary fallback via SupabaseSignalingChannel.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/integrations/supabase/client';

export interface CallSessionCredentials {
  call_id: string;
  signaling_url: string | null;
  token: string | null;
  ice_config: RTCConfiguration;
  signaling_mode: 'relay' | 'supabase_fallback';
}

export interface CallSessionEndResult {
  call_id: string;
  status: string;
}

async function invokeCallSession<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('call-session: not authenticated');
  }
  const { data, error } = await supabase.functions.invoke('call-session', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const msg = typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : String(error);
    throw new Error(`call-session: ${msg}`);
  }
  if (data?.error) {
    throw new Error(`call-session: ${data.error}`);
  }
  return data as T;
}

/**
 * Start a new call in a room.
 * Returns call ID + signaling credentials for WebSocket relay connection.
 */
export async function startCallSession(roomId: string): Promise<CallSessionCredentials> {
  return invokeCallSession<CallSessionCredentials>({
    action: 'start',
    room_id: roomId,
  });
}

/**
 * Join an existing call (as callee).
 * If callId is omitted, joins the active call in the room.
 * Returns signaling credentials for WebSocket relay connection.
 */
export async function joinCallSession(
  roomId: string,
  callId?: string,
): Promise<CallSessionCredentials> {
  return invokeCallSession<CallSessionCredentials>({
    action: 'join',
    room_id: roomId,
    ...(callId ? { call_id: callId } : {}),
  });
}

/**
 * End a call. Marks the call as ended in the database.
 */
export async function endCallSession(
  callId: string,
  endReason = 'ended',
): Promise<CallSessionEndResult> {
  return invokeCallSession<CallSessionEndResult>({
    action: 'end',
    call_id: callId,
    end_reason: endReason,
  });
}
