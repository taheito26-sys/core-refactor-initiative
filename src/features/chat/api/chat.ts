// ─── Unified Chat API ─────────────────────────────────────────────────────
// All supabase calls go through here. Components never touch supabase directly.

import { supabase } from '@/integrations/supabase/client';
import type {
  ChatMessage, ChatRoomListItem, ChatRoomMember, ChatAttachment,
  ChatCall, ChatCallParticipant, ChatReaction, SendMessageInput,
  ChatPresence, IceConfig,
} from '../types';

// ── helpers ────────────────────────────────────────────────────────────────
function rpcError(name: string, error: unknown): Error {
  const msg = (error as { message?: string })?.message ?? 'Unknown error';
  console.error(`[chat:${name}]`, error);
  return new Error(msg);
}

// ── Rooms ──────────────────────────────────────────────────────────────────
export async function getRooms(): Promise<ChatRoomListItem[]> {
  const { data, error } = await supabase.rpc('chat_get_rooms' as never);
  if (error) throw rpcError('getRooms', error);
  return (data ?? []) as ChatRoomListItem[];
}

export async function getOrCreateDirectRoom(
  otherUserId: string,
  roomName?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('chat_get_or_create_direct_room', {
    _other_user_id: otherUserId,
    _room_name: roomName ?? null,
  } as never);
  if (error) throw rpcError('getOrCreateDirectRoom', error);
  return data as string;
}

export async function createMerchantClientRoom(
  customerUserId: string,
  roomName?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('chat_create_merchant_client_room', {
    _customer_user_id: customerUserId,
    _room_name: roomName ?? null,
  } as never);
  if (error) throw rpcError('createMerchantClientRoom', error);
  return data as string;
}

export async function getOrCreateCollabRoom(name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('chat_get_or_create_collab_room', {
    _name: name ?? 'Merchants Hub',
  } as never);
  if (error) throw rpcError('getOrCreateCollabRoom', error);
  return data as string;
}

export async function getRoomMembers(roomId: string): Promise<ChatRoomMember[]> {
  const { data, error } = await supabase
    .from('chat_room_members' as never)
    .select('*')
    .eq('room_id', roomId)
    .is('removed_at', null);
  if (error) throw rpcError('getRoomMembers', error);
  return (data ?? []) as unknown as ChatRoomMember[];
}

// ── Messages ───────────────────────────────────────────────────────────────
export async function getMessages(
  roomId: string,
  limit = 60,
  before?: string,   // ISO timestamp for pagination
): Promise<ChatMessage[]> {
  let query = supabase
    .from('chat_messages' as never)
    .select('*')
    .eq('room_id', roomId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw rpcError('getMessages', error);
  const msgs = ((data ?? []) as unknown as ChatMessage[]).reverse();
  return msgs;
}

export async function sendMessage(input: SendMessageInput): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('chat_send_message', {
    _room_id:        input.roomId,
    _content:        input.content,
    _type:           input.type ?? 'text',
    _metadata:       input.metadata ?? {},
    _reply_to_id:    input.replyToId ?? null,
    _client_nonce:   input.clientNonce ?? null,
    _expires_at:     input.expiresAt ?? null,
    _view_once:      input.viewOnce ?? false,
    _watermark_text: input.watermarkText ?? null,
  } as never);
  if (error) throw rpcError('sendMessage', error);
  const msg = Array.isArray(data) ? data[0] : data;
  return msg as unknown as ChatMessage;
}

export async function editMessage(messageId: string, newContent: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('chat_edit_message', {
    _message_id:  messageId,
    _new_content: newContent,
  } as never);
  if (error) throw rpcError('editMessage', error);
  const msg = Array.isArray(data) ? data[0] : data;
  return msg as unknown as ChatMessage;
}

export async function deleteMessage(messageId: string, forEveryone = false): Promise<void> {
  const { error } = await supabase.rpc('chat_delete_message', {
    _message_id:   messageId,
    _for_everyone: forEveryone,
  } as never);
  if (error) throw rpcError('deleteMessage', error);
}

export async function markRoomRead(roomId: string, upToMessageId?: string): Promise<void> {
  const { error } = await supabase.rpc('chat_mark_room_read', {
    _room_id:           roomId,
    _up_to_message_id:  upToMessageId ?? null,
  } as never);
  if (error) throw rpcError('markRoomRead', error);
}

export async function markMessageViewed(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_mark_viewed', {
    _message_id: messageId,
  } as never);
  if (error) throw rpcError('markMessageViewed', error);
}

export async function searchMessages(roomId: string, query: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('chat_search_messages', {
    _room_id: roomId,
    _query:   query,
    _limit:   40,
  } as never);
  if (error) throw rpcError('searchMessages', error);
  return (data ?? []) as unknown as ChatMessage[];
}

// ── Reactions ──────────────────────────────────────────────────────────────
export async function addReaction(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('chat_add_reaction', {
    _message_id: messageId,
    _emoji:      emoji,
  } as never);
  if (error) throw rpcError('addReaction', error);
}

export async function removeReaction(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('chat_remove_reaction', {
    _message_id: messageId,
    _emoji:      emoji,
  } as never);
  if (error) throw rpcError('removeReaction', error);
}

export async function getMessageReactions(messageId: string): Promise<ChatReaction[]> {
  const { data, error } = await supabase
    .from('chat_message_reactions' as never)
    .select('*')
    .eq('message_id', messageId);
  if (error) throw rpcError('getMessageReactions', error);
  return (data ?? []) as unknown as ChatReaction[];
}

// ── Typing ─────────────────────────────────────────────────────────────────
export async function setTyping(roomId: string, isTyping: boolean): Promise<void> {
  const { error } = await supabase.rpc('chat_set_typing', {
    _room_id:   roomId,
    _is_typing: isTyping,
  } as never);
  if (error) console.warn('[chat:setTyping]', error); // non-fatal
}

// ── Presence ───────────────────────────────────────────────────────────────
export async function setPresence(
  status: 'online' | 'away' | 'offline',
  deviceInfo?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc('chat_set_presence', {
    _status:      status,
    _device_info: deviceInfo ?? {},
  } as never);
  if (error) console.warn('[chat:setPresence]', error);
}

export async function getPresence(userIds: string[]): Promise<ChatPresence[]> {
  const { data, error } = await supabase
    .from('chat_presence' as never)
    .select('*')
    .in('user_id', userIds);
  if (error) throw rpcError('getPresence', error);
  return (data ?? []) as unknown as ChatPresence[];
}

// ── Attachments ────────────────────────────────────────────────────────────

/** Validate file before upload */
export function validateAttachment(
  file: File,
  maxMb = 100,
): { ok: boolean; error?: string } {
  const maxBytes = maxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return { ok: false, error: `File too large. Max ${maxMb} MB.` };
  }
  const allowed = [
    'image/jpeg','image/png','image/gif','image/webp','image/heic',
    'video/mp4','video/webm',
    'audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/mp4',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv',
  ];
  if (!allowed.includes(file.type)) {
    return { ok: false, error: `File type not allowed: ${file.type}` };
  }
  return { ok: true };
}

export async function uploadAttachment(
  roomId: string,
  uploaderId: string,
  file: File,
  opts?: {
    durationMs?: number;
    waveform?: number[];
    width?: number;
    height?: number;
  },
): Promise<ChatAttachment> {
  const validation = validateAttachment(file);
  if (!validation.ok) throw new Error(validation.error);

  const ext   = file.name.split('.').pop() ?? 'bin';
  const path  = `${uploaderId}/${roomId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadErr) throw rpcError('uploadAttachment:upload', uploadErr);

  const { data: att, error: insertErr } = await supabase
    .from('chat_attachments')
    .insert({
      room_id:     roomId,
      uploader_id: uploaderId,
      storage_path: path,
      file_name:   file.name,
      file_size:   file.size,
      mime_type:   file.type,
      duration_ms: opts?.durationMs ?? null,
      waveform:    opts?.waveform   ?? null,
      width:       opts?.width      ?? null,
      height:      opts?.height     ?? null,
      is_validated: true,
    })
    .select('*')
    .single();

  if (insertErr) throw rpcError('uploadAttachment:insert', insertErr);
  return att as unknown as ChatAttachment;
}

export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw rpcError('getSignedUrl', error);
  return data.signedUrl;
}

export async function linkAttachmentToMessage(
  attachmentId: string,
  messageId: string,
): Promise<void> {
  const { error } = await supabase
    .from('chat_attachments')
    .update({ message_id: messageId } as never)
    .eq('id', attachmentId);
  if (error) throw rpcError('linkAttachmentToMessage', error);
}

export async function getAttachment(messageId: string): Promise<ChatAttachment | null> {
  const { data, error } = await supabase
    .from('chat_attachments' as never)
    .select('*')
    .eq('message_id', messageId)
    .maybeSingle();
  if (error) throw rpcError('getAttachment', error);
  if (!data) return null;
  const att = data as unknown as ChatAttachment;
  att.signed_url = await getSignedUrl(att.storage_path);
  return att;
}

// ── Calls ──────────────────────────────────────────────────────────────────

/** Default ICE config using public STUNs + the relay fallback */
export const DEFAULT_ICE_CONFIG: IceConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] },
    // TURN relay — replace with your own credentials in production
    ...(import.meta.env.VITE_TURN_URL
      ? [{
          urls:       import.meta.env.VITE_TURN_URL as string,
          username:   import.meta.env.VITE_TURN_USERNAME as string,
          credential: import.meta.env.VITE_TURN_CREDENTIAL as string,
        }]
      : []),
  ],
  iceTransportPolicy: 'all',   // 'relay' to force TURN only
};

export async function initiateCall(roomId: string): Promise<string> {
  const { data, error } = await supabase.rpc('chat_initiate_call', {
    _room_id: roomId,
  } as never);
  if (error) throw rpcError('initiateCall', error);
  return data as string;
}

export async function answerCall(callId: string, sdpAnswer: string): Promise<void> {
  const { error } = await supabase.rpc('chat_answer_call', {
    _call_id:    callId,
    _sdp_answer: sdpAnswer,
  } as never);
  if (error) throw rpcError('answerCall', error);
}

export async function endCall(callId: string, endReason = 'ended'): Promise<void> {
  const { error } = await supabase.rpc('chat_end_call', {
    _call_id:    callId,
    _end_reason: endReason,
  } as never);
  if (error) throw rpcError('endCall', error);
}

export async function pushIceCandidate(
  callId: string,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  const { error } = await supabase.rpc('chat_push_ice_candidate', {
    _call_id:   callId,
    _candidate: candidate,
  } as never);
  if (error) console.warn('[chat:pushIceCandidate]', error); // non-fatal
}

export async function getCallParticipants(callId: string): Promise<ChatCallParticipant[]> {
  const { data, error } = await supabase
    .from('chat_call_participants' as never)
    .select('*')
    .eq('call_id', callId);
  if (error) throw rpcError('getCallParticipants', error);
  return (data ?? []) as unknown as ChatCallParticipant[];
}

export async function getActiveCall(roomId: string): Promise<ChatCall | null> {
  const { data, error } = await supabase
    .from('chat_calls' as never)
    .select('*')
    .eq('room_id', roomId)
    .in('status', ['ringing', 'active'])
    .maybeSingle();
  if (error) throw rpcError('getActiveCall', error);
  return data as unknown as ChatCall | null;
}
