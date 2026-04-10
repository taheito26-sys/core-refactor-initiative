// ─── Unified Chat API ─────────────────────────────────────────────────────
// All supabase calls go through here. Components never touch supabase directly.

import { supabase } from '@/integrations/supabase/client';
import { selectIceConfig } from '../lib/resilient-ice';
import type {
  ChatMessage, ChatRoomListItem, ChatRoomMember, ChatAttachment,
  ChatCall, ChatCallParticipant, ChatReaction, SendMessageInput,
  ChatPresence, IceConfig, ChatMarketOffer, CreateMarketOfferInput, ChatExpiryCleanupResult, ChatTranscriptEntry,
} from '../types';

// ── helpers ────────────────────────────────────────────────────────────────
function rpcError(name: string, error: unknown): Error {
  const msg = (error as { message?: string })?.message ?? 'Unknown error';
  console.error(`[chat:${name}]`, error);
  return new Error(msg);
}

function buildAttachmentStub(input: {
  attachmentId: string;
  roomId: string;
  uploaderId: string;
  storagePath: string;
  file: File;
  thumbnailPath: string | null;
  durationMs?: number;
  waveform?: number[];
  width?: number;
  height?: number;
}): ChatAttachment {
  return {
    id: input.attachmentId,
    message_id: null,
    room_id: input.roomId,
    uploader_id: input.uploaderId,
    storage_path: input.storagePath,
    cdn_url: null,
    file_name: input.file.name,
    file_size: input.file.size,
    mime_type: input.file.type,
    thumbnail_path: input.thumbnailPath,
    duration_ms: input.durationMs ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    waveform: input.waveform ?? null,
    checksum_sha256: null,
    is_validated: true,
    is_encrypted: false,
    iv: null,
    auth_tag: null,
    created_at: new Date().toISOString(),
  };
}

// ── Rooms ──────────────────────────────────────────────────────────────────
export async function getRooms(): Promise<ChatRoomListItem[]> {
  const { data, error } = await supabase.rpc('chat_get_rooms_v2' as never);
  if (error) throw rpcError('getRooms', error);
  return (data ?? []) as ChatRoomListItem[];
}

export async function getQatarMarketRoom(): Promise<string> {
  const { data, error } = await supabase.rpc('chat_get_qatar_market_room' as never);
  if (error) throw rpcError('getQatarMarketRoom', error);
  return data as string;
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
  const { data, error } = await supabase.rpc('chat_get_room_members' as never, {
    _room_id: roomId,
  } as never);
  if (error) throw rpcError('getRoomMembers', error);
  return (data ?? []) as unknown as ChatRoomMember[];
}

export async function getMarketOffers(roomId: string): Promise<ChatMarketOffer[]> {
  const { data, error } = await supabase
    .from('market_offers' as never)
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false });
  if (error) throw rpcError('getMarketOffers', error);
  return (data ?? []) as unknown as ChatMarketOffer[];
}

export async function createMarketOffer(input: CreateMarketOfferInput): Promise<ChatMarketOffer> {
  const { data, error } = await supabase.rpc('chat_create_market_offer' as never, {
    _room_id: input.roomId,
    _offer_type: input.offerType,
    _amount: input.amount,
    _price: input.price,
    _payment_methods: input.paymentMethods ?? [],
    _notes: input.notes ?? null,
    _min_amount: input.minAmount ?? null,
    _max_amount: input.maxAmount ?? null,
    _expires_at: input.expiresAt ?? null,
  } as never);
  if (error) throw rpcError('createMarketOffer', error);
  return data as unknown as ChatMarketOffer;
}

export async function cancelMarketOffer(offerId: string): Promise<ChatMarketOffer> {
  const { data, error } = await supabase.rpc('chat_cancel_market_offer' as never, {
    _offer_id: offerId,
  } as never);
  if (error) throw rpcError('cancelMarketOffer', error);
  return data as unknown as ChatMarketOffer;
}

export async function forwardMessage(
  messageId: string,
  targetRoomId: string,
  clientNonce = crypto.randomUUID(),
): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('chat_forward_message' as never, {
    _message_id: messageId,
    _target_room_id: targetRoomId,
    _client_nonce: clientNonce,
  } as never);
  if (error) throw rpcError('forwardMessage', error);
  return data as unknown as ChatMessage;
}

export async function exportRoomTranscript(roomId: string): Promise<ChatTranscriptEntry[]> {
  const { data, error } = await supabase.rpc('chat_export_room_transcript' as never, {
    _room_id: roomId,
  } as never);
  if (error) throw rpcError('exportRoomTranscript', error);
  return (data ?? []) as unknown as ChatTranscriptEntry[];
}

export async function runExpiryCleanup(): Promise<ChatExpiryCleanupResult> {
  const { data, error } = await supabase.rpc('chat_run_expiry_cleanup' as never);
  if (error) {
    const code = (error as { code?: string })?.code;
    const message = (error as { message?: string })?.message ?? '';
    if (code === '42501' && message.includes('Storage API')) {
      return {
        expired_messages: 0,
        expired_offers: 0,
        cleaned_attachments: 0,
        cleaned_storage_objects: 0,
        ran_at: new Date().toISOString(),
      } as ChatExpiryCleanupResult;
    }
    throw rpcError('runExpiryCleanup', error);
  }
  return data as ChatExpiryCleanupResult;
}

export async function updateRoomPolicy(
  roomId: string,
  updates: Partial<Record<string, boolean>>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc('chat_update_room_policy' as never, {
    _room_id: roomId,
    _updates: updates,
  } as never);
  if (error) throw rpcError('updateRoomPolicy', error);
  return data;
}

// ── Presence for room members ─────────────────────────────────────────────
export async function getRoomOnlineCount(roomId: string): Promise<number> {
  const { data: members } = await supabase
    .from('chat_room_members' as never)
    .select('user_id')
    .eq('room_id', roomId)
    .is('removed_at', null);
  if (!members || !Array.isArray(members)) return 0;
  
  const userIds = (members as { user_id: string }[]).map(m => m.user_id);
  if (userIds.length === 0) return 0;
  
  const { count } = await supabase
    .from('chat_presence' as never)
    .select('user_id', { count: 'exact', head: true })
    .in('user_id', userIds)
    .eq('status', 'online');
  
  return count ?? 0;
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

  // Enrich with receipt status — fetch receipts for these messages
  // IMPORTANT: Only consider receipts from OTHER users (not the sender).
  // The sender's own receipt should never mark a message as "read".
  if (msgs.length > 0) {
    const msgIds = msgs.map((m) => m.id);
    const { data: receipts } = await supabase
      .from('chat_message_receipts' as never)
      .select('message_id, status, user_id')
      .in('message_id', msgIds);

    if (receipts && Array.isArray(receipts)) {
      // Build sender map so we can skip self-receipts
      const senderMap = new Map<string, string>();
      for (const m of msgs) senderMap.set(m.id, m.sender_id);

      // Build a map: message_id → highest status from non-sender users
      const statusMap = new Map<string, string>();
      for (const r of receipts as { message_id: string; status: string; user_id: string }[]) {
        // Skip the sender's own receipt
        if (r.user_id === senderMap.get(r.message_id)) continue;

        const current = statusMap.get(r.message_id);
        if (!current || r.status === 'read' || (r.status === 'delivered' && current !== 'read')) {
          statusMap.set(r.message_id, r.status);
        }
      }
      for (const m of msgs) {
        const s = statusMap.get(m.id);
        if (s) m.receipt_status = s as ChatMessage['receipt_status'];
        else m.receipt_status = 'sent';
      }
    }
  }

  // Enrich with attachments
  const attachedMsgIds = msgs.filter((m) => m.type === 'image' || m.type === 'file' || m.type === 'voice_note').map((m) => m.id);
  if (attachedMsgIds.length > 0) {
    const { data: attachments } = await supabase
      .from('chat_attachments' as never)
      .select('*')
      .in('message_id', attachedMsgIds);

    if (attachments && Array.isArray(attachments)) {
      const attMap = new Map<string, ChatAttachment>();
      for (const a of attachments as unknown as ChatAttachment[]) {
        if (a.message_id) attMap.set(a.message_id, a);
      }
      for (const m of msgs) {
        const att = attMap.get(m.id);
        if (att) m.attachment = att;
      }
    }
  }

  return msgs;
}

export async function getAttachmentsForMessages(messageIds: string[]): Promise<ChatAttachment[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from('chat_attachments' as never)
    .select('*')
    .in('message_id', messageIds);
  if (error) throw rpcError('getAttachmentsForMessages', error);
  const attachments = (data ?? []) as unknown as ChatAttachment[];
  await Promise.all(attachments.map(async (attachment) => {
    if (attachment.thumbnail_path) {
      attachment.thumbnail_signed_url = await getSignedUrl(attachment.thumbnail_path);
    }
  }));
  return attachments;
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
    _attachment_id:  input.attachmentId ?? null,
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

export async function getMessageById(messageId: string): Promise<ChatMessage | null> {
  const { data, error } = await supabase
    .from('chat_messages' as never)
    .select('*')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw rpcError('getMessageById', error);
  return (data ?? null) as ChatMessage | null;
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
    thumbnailBlob?: Blob | null;
  },
): Promise<ChatAttachment> {
  const validation = validateAttachment(file);
  if (!validation.ok) throw new Error(validation.error);

  const ext   = file.name.split('.').pop() ?? 'bin';
  const path  = `${uploaderId}/${roomId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
  const thumbnailPath = opts?.thumbnailBlob
    ? `${uploaderId}/${roomId}/thumb_${Date.now()}_${crypto.randomUUID()}.jpg`
    : null;

  const { error: uploadErr } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadErr) throw rpcError('uploadAttachment:upload', uploadErr);

  if (thumbnailPath && opts?.thumbnailBlob) {
    const { error: thumbnailUploadErr } = await supabase.storage
      .from('chat-attachments')
      .upload(thumbnailPath, opts.thumbnailBlob, { contentType: 'image/jpeg', upsert: false });

    if (thumbnailUploadErr) {
      await supabase.storage.from('chat-attachments').remove([path]).catch(() => {});
      throw rpcError('uploadAttachment:thumbnailUpload', thumbnailUploadErr);
    }
  }

  const attachmentStub = (attachmentId: string) => buildAttachmentStub({
    attachmentId,
    roomId,
    uploaderId,
    storagePath: path,
    file,
    thumbnailPath,
    durationMs: opts?.durationMs,
    waveform: opts?.waveform,
    width: opts?.width,
    height: opts?.height,
  });

  const modernPayload = {
    _room_id: roomId,
    _storage_path: path,
    _file_name: file.name,
    _file_size: file.size,
    _mime_type: file.type,
    _thumbnail_path: thumbnailPath,
    _duration_ms: opts?.durationMs ?? null,
    _width: opts?.width ?? null,
    _height: opts?.height ?? null,
    _waveform: opts?.waveform ?? null,
    _checksum_sha256: null,
    _cdn_url: null,
    _is_encrypted: false,
    _iv: null,
    _auth_tag: null,
  };

  const { data: att, error: insertErr } = await supabase.rpc('chat_create_attachment' as never, modernPayload as never);

  if ((insertErr as { code?: string } | null)?.code === 'PGRST202') {
    const legacyPayload = {
      _room_id: roomId,
      _message_id: null,
      _storage_path: path,
      _file_name: file.name,
      _file_size: file.size,
      _mime_type: file.type,
      _cdn_url: null,
      _thumbnail_path: thumbnailPath,
      _duration_ms: opts?.durationMs ?? null,
      _width: opts?.width ?? null,
      _height: opts?.height ?? null,
      _waveform: opts?.waveform ?? null,
      _checksum_sha256: null,
      _is_encrypted: false,
      _iv: null,
      _auth_tag: null,
    };

    const { data: legacyAtt, error: legacyInsertErr } = await supabase.rpc('chat_create_attachment' as never, legacyPayload as never);
    if (legacyInsertErr) {
      const pathsToRemove = thumbnailPath ? [path, thumbnailPath] : [path];
      await supabase.storage.from('chat-attachments').remove(pathsToRemove).catch(() => {});
      throw rpcError('uploadAttachment:insert', legacyInsertErr);
    }

    const attachmentId = typeof legacyAtt === 'string' ? legacyAtt : (legacyAtt as { id?: string } | null)?.id;
    if (!attachmentId) {
      const pathsToRemove = thumbnailPath ? [path, thumbnailPath] : [path];
      await supabase.storage.from('chat-attachments').remove(pathsToRemove).catch(() => {});
      throw new Error('Attachment upload succeeded but no attachment ID was returned');
    }

    return attachmentStub(attachmentId);
  }

  if (insertErr) {
    const pathsToRemove = thumbnailPath ? [path, thumbnailPath] : [path];
    await supabase.storage.from('chat-attachments').remove(pathsToRemove).catch(() => {});
    throw rpcError('uploadAttachment:insert', insertErr);
  }

  if (typeof att === 'string') {
    return attachmentStub(att);
  }

  return att as unknown as ChatAttachment;
}

export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw rpcError('getSignedUrl', error);
  return data.signedUrl;
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
  if (att.thumbnail_path) {
    att.thumbnail_signed_url = await getSignedUrl(att.thumbnail_path);
  }
  return att;
}

// ── Calls ──────────────────────────────────────────────────────────────────

/**
 * ICE configuration: 15+ STUN servers across diverse providers/geographies
 * + multi-transport TURN (UDP 3478, TCP 443, TLS 443).
 * TCP/TLS on port 443 masquerades as HTTPS, bypassing most DPI firewalls.
 * See src/features/chat/lib/resilient-ice.ts for the full server list.
 */
export const DEFAULT_ICE_CONFIG: IceConfig = selectIceConfig();

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

const ROOM_CLEAR_STORAGE_KEY = 'chat_room_cleared_at';

function readRoomClearMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROOM_CLEAR_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

function writeRoomClearMap(next: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ROOM_CLEAR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

export function getRoomClearedAt(roomId: string): string | null {
  return readRoomClearMap()[roomId] ?? null;
}

// ── Clear chat (hide messages for current user) ────────────────────────────
export async function clearChatForMe(roomId: string): Promise<string> {
  const clearedAt = new Date().toISOString();
  writeRoomClearMap({ ...readRoomClearMap(), [roomId]: clearedAt });

  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return clearedAt;

  const { error } = await supabase
    .from('chat_room_members' as never)
    .update({ last_read_at: clearedAt } as never)
    .eq('room_id', roomId)
    .eq('user_id', userId);
  if (error) throw rpcError('clearChatForMe', error);
  return clearedAt;
}

// ── Mute / unmute room ─────────────────────────────────────────────────────
export async function toggleMuteRoom(roomId: string, mute: boolean): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('chat_room_members' as never)
    .update({ is_muted: mute } as never)
    .eq('room_id', roomId)
    .eq('user_id', userId);
  if (error) throw rpcError('toggleMuteRoom', error);
}
