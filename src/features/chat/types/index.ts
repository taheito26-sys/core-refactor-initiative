// ─── Unified Chat Platform — TypeScript types ──────────────────────────────

export type ChatRoomType = 'merchant_private' | 'merchant_client' | 'merchant_collab';
export type ChatMemberRole = 'owner' | 'admin' | 'member' | 'guest';
export type ChatMessageType =
  | 'text' | 'voice_note' | 'image' | 'file' | 'system'
  | 'call_summary' | 'order_card' | 'payment_card' | 'reaction_burst';
export type ChatCallStatus =
  | 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'failed' | 'no_answer';
export type ChatEncryptionMode = 'none' | 'tls_only' | 'server_e2ee' | 'client_e2ee';
export type PresenceStatus = 'online' | 'away' | 'offline';

// ── Policy ─────────────────────────────────────────────────────────────────
export interface ChatRoomPolicy {
  id: string;
  room_type: ChatRoomType;
  encryption_mode: ChatEncryptionMode;
  retention_hours: number | null;
  allow_files: boolean;
  allow_voice_notes: boolean;
  allow_images: boolean;
  allow_calls: boolean;
  allow_group_calls: boolean;
  moderation_level: 'none' | 'light' | 'strict';
  history_searchable: boolean;
  watermark_enabled: boolean;
  disappearing_default_hours: number | null;
  max_file_size_mb: number;
  allowed_mime_types: string[] | null;
  screenshot_protection: boolean;
  link_preview_enabled: boolean;
}

// ── Room ───────────────────────────────────────────────────────────────────
export interface ChatRoom {
  id: string;
  type: ChatRoomType;
  name: string | null;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  policy_id: string | null;
  last_message_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_direct: boolean;
  is_announcement_only: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Room as returned by chat_get_rooms() RPC (includes member + unread state)
export interface ChatRoomListItem {
  room_id: string;
  room_type: ChatRoomType;
  name: string | null;
  avatar_url: string | null;
  is_direct: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_muted: boolean;
  is_pinned: boolean;
  is_archived: boolean;
  member_count: number;
  other_user_id: string | null;
  other_user_metadata: Record<string, unknown>;
  // enriched client-side
  display_name?: string;
  display_avatar?: string | null;
  policy?: ChatRoomPolicy;
}

// ── Member ─────────────────────────────────────────────────────────────────
export interface ChatRoomMember {
  id: string;
  room_id: string;
  user_id: string;
  role: ChatMemberRole;
  display_name_override: string | null;
  joined_at: string;
  invited_by: string | null;
  is_muted: boolean;
  muted_until: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  notification_level: 'all' | 'mentions' | 'none';
  last_read_message_id: string | null;
  last_read_at: string | null;
  removed_at: string | null;
  // enriched
  display_name?: string;
  avatar_url?: string | null;
}

// ── Message ────────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  type: ChatMessageType;
  content: string;
  metadata: ChatMessageMetadata;
  reply_to_id: string | null;
  forwarded_from_id: string | null;
  client_nonce: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_for_sender: boolean;
  expires_at: string | null;
  view_once: boolean;
  viewed_by: string[];
  watermark_text: string | null;
  created_at: string;
  updated_at: string;
  // enriched client-side
  sender_name?: string;
  sender_avatar?: string | null;
  reactions?: ChatReaction[];
  receipt_status?: 'sent' | 'delivered' | 'read';
  attachment?: ChatAttachment | null;
}

export interface ChatMessageMetadata {
  reply_preview?: {
    id: string;
    sender_name: string;
    content: string;
    type: ChatMessageType;
  };
  forwarded_from?: {
    sender_name: string;
    room_name?: string;
  };
  call_id?: string;
  call_event?: string;
  duration_seconds?: number;
  order_id?: string;
  payment_id?: string;
  // voice note
  waveform?: number[];
  duration_ms?: number;
  // image / file
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
  thumbnail_url?: string;
  // system event
  event?: string;
  [key: string]: unknown;
}

// ── Receipt ────────────────────────────────────────────────────────────────
export interface ChatReceipt {
  message_id: string;
  room_id: string;
  user_id: string;
  status: 'sent' | 'delivered' | 'read';
  updated_at: string;
}

// ── Reaction ───────────────────────────────────────────────────────────────
export interface ChatReaction {
  id: string;
  message_id: string;
  room_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// Aggregated view used in UI
export interface ReactionSummary {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
  user_ids: string[];
}

// ── Attachment ─────────────────────────────────────────────────────────────
export interface ChatAttachment {
  id: string;
  message_id: string | null;
  room_id: string;
  uploader_id: string;
  storage_path: string;
  cdn_url: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  thumbnail_path: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  waveform: number[] | null;
  checksum_sha256: string | null;
  is_validated: boolean;
  is_encrypted: boolean;
  iv: string | null;
  auth_tag: string | null;
  created_at: string;
  // derived
  signed_url?: string;
  thumbnail_signed_url?: string | null;
}

// ── Call ───────────────────────────────────────────────────────────────────
export interface ChatCall {
  id: string;
  room_id: string;
  initiated_by: string;
  status: ChatCallStatus;
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  ice_config: IceConfig | null;
  quality_stats: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatCallParticipant {
  id: string;
  call_id: string;
  user_id: string;
  status: 'ringing' | 'connected' | 'disconnected' | 'declined';
  joined_at: string | null;
  left_at: string | null;
  sdp_offer: string | null;
  sdp_answer: string | null;
  ice_candidates: RTCIceCandidateInit[];
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

// ── Presence ───────────────────────────────────────────────────────────────
export interface ChatPresence {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: string;
  device_info: Record<string, unknown>;
  updated_at: string;
}

// ── Typing ─────────────────────────────────────────────────────────────────
export interface ChatTypingState {
  room_id: string;
  user_id: string;
  is_typing: boolean;
  expires_at: string;
  updated_at: string;
}

// ── Device Keys (E2EE Phase 3) ─────────────────────────────────────────────
export interface ChatDeviceKey {
  id: string;
  user_id: string;
  device_id: string;
  key_type: 'identity' | 'signed_prekey' | 'one_time_prekey';
  public_key: string;
  key_id: number | null;
  signature: string | null;
  is_active: boolean;
  created_at: string;
  used_at: string | null;
}

// ── Audit ──────────────────────────────────────────────────────────────────
export interface ChatAuditEvent {
  id: string;
  room_id: string | null;
  user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

// ── Send input ─────────────────────────────────────────────────────────────
export interface SendMessageInput {
  roomId: string;
  content: string;
  type?: ChatMessageType;
  metadata?: ChatMessageMetadata;
  replyToId?: string | null;
  clientNonce?: string;
  expiresAt?: string | null;
  viewOnce?: boolean;
  watermarkText?: string | null;
  attachmentId?: string | null;
}

// ── Optimistic message ─────────────────────────────────────────────────────
export interface OptimisticMessage extends ChatMessage {
  _optimistic: true;
  _pending: boolean;
  _failed: boolean;
}

export function isOptimistic(m: ChatMessage): m is OptimisticMessage {
  return '_optimistic' in m;
}
