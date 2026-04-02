export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
export type RoomKind = 'direct' | 'group' | 'system';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'cancelled';

export interface ChatCallSession {
  id: string;
  room_id: string;
  initiated_by: string;
  status: CallStatus;
  started_at: string;
  ended_at?: string;
}

export type InboxLane = 'Personal' | 'Team' | 'Customers' | 'Deals' | 'Alerts' | 'Archived';

export interface SecurityPolicies {
  disable_forwarding: boolean;
  disable_copy: boolean;
  disable_export: boolean;
  watermark: boolean;
}

export type RetentionPolicy = 'indefinite' | '30d' | '7d' | '24h' | 'view_once';

export interface ChatRoom {
  room_id: string;
  kind: RoomKind;
  lane: InboxLane;
  title: string | null;
  relationship_id: string | null;
  member_role: 'owner' | 'admin' | 'member';
  unread_count: number;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  updated_at: string;
  security_policies?: SecurityPolicies;
  retention_policy?: RetentionPolicy;
  type?: 'standard' | 'broadcast' | 'approval' | 'incident' | 'deal' | 'temporary';
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_identity_id?: string;
  body: string;
  body_json: Record<string, unknown>;
  message_type: string;
  status: MessageStatus;
  reply_to_message_id: string | null;
  client_nonce: string | null;
  created_at: string;
  delivered_at: string | null;
  deleted_for_everyone_at: string | null;
  expires_at?: string;
  permissions?: {
    forwardable: boolean;
    exportable: boolean;
    copyable: boolean;
    ai_readable: boolean;
  };
  metadata?: {
    is_edited?: boolean;
    edited_at?: string;
    vanish_at?: string;
    is_forwarded?: boolean;
    original_sender_name?: string;
    voice_duration?: number;
    poll_question?: string;
    poll_options?: string[];
  };
}

export interface ChatBusinessObject {
  id: string;
  room_id: string;
  type: 'business_object';
  object_type: 'order' | 'payment' | 'agreement' | 'dispute' | 'task' | 'deal_offer' | 'snapshot';
  source_message_id?: string;
  created_by: string;
  state_snapshot_hash?: string; 
  payload: any;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'locked';
  created_at: string;
}

export type TimelineItem = (ChatMessage & { type?: 'message' }) | ChatBusinessObject;

export interface DeterministicResult<T> {
  ok: boolean;
  data: T;
  error: string | null;
}

export function ok<T>(data: T): DeterministicResult<T> {
  return { ok: true, data, error: null };
}

export function fail<T>(fallback: T, error: unknown): DeterministicResult<T> {
  const msg = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return { ok: false, data: fallback, error: msg };
}