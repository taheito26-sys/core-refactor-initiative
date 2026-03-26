export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

import { InboxLane } from '@/lib/os-store';
export { type InboxLane };

export interface ChatRoom {
  room_id: string;
  kind: 'direct' | 'group' | 'system';
  lane?: InboxLane;
  title: string | null;
  relationship_id: string | null;
  member_role: 'owner' | 'admin' | 'member';
  unread_count: number;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  updated_at: string;
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

export interface ChatReaction {
  message_id: string;
  user_id: string;
  reaction: string;
}

export interface ChatPin {
  message_id: string;
  pinned_at: string;
  pinned_by: string;
}

export interface ChatSearchResult {
  message_id: string;
  room_id: string;
  body: string;
  created_at: string;
  room_title: string | null;
  snippet: string | null;
}

export interface ChatCallSession {
  id: string;
  room_id: string;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'cancelled';
  started_by: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
}

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
