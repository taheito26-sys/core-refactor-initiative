export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatRoom {
  room_id: string;
  kind: 'direct' | 'group' | 'system';
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
  body: string;
  body_json: Record<string, unknown>;
  message_type: string;
  status: MessageStatus;
  reply_to_message_id: string | null;
  client_nonce: string | null;
  created_at: string;
  delivered_at: string | null;
  deleted_for_everyone_at: string | null;
}

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
