// src/lib/os-store.ts

export type GlobalRole = 'admin' | 'member' | 'guest' | 'compliance';
export type RoomType = 'standard' | 'broadcast' | 'approval' | 'incident' | 'deal' | 'temporary';
export type RetentionPolicy = 'indefinite' | '30d' | '7d' | '24h' | 'view_once';
export type InboxLane = 'Personal' | 'Team' | 'Customers' | 'Deals' | 'Alerts' | 'Archived';
export type ProviderType = 'WhatsApp' | 'Web' | 'Telegram' | 'Email' | 'SMS';

export interface ChannelIdentity {
  id: string;
  provider_type: ProviderType;
  provider_uid: string;
  confidence_level: 'certain' | 'probable' | 'unresolved';
}

export interface SecurityPolicies {
  disable_forwarding: boolean;
  disable_copy: boolean;
  disable_export: boolean;
  watermark: boolean;
}

export interface MessagePermissions {
  forwardable: boolean;
  exportable: boolean;
  copyable: boolean;
  ai_readable: boolean;
}

export interface OsUser {
  id: string;
  global_role: GlobalRole;
  trust_score: { value: number; factors: string[] };
  identities: ChannelIdentity[];
}

export interface OsRoom {
  id: string;
  name: string;
  type: RoomType;
  lane: InboxLane;
  security_policies: SecurityPolicies;
  retention_policy: RetentionPolicy;
}

// Dual Timeline Support: The timeline is a unified stream of generic OS Items.
export type TimelineItemType = 'message' | 'business_object';

export interface BaseTimelineItem {
  id: string;
  type: TimelineItemType;
  room_id: string;
  created_at: string;
}

export interface OsMessage extends BaseTimelineItem {
  type: 'message';
  thread_id?: string;
  sender_id: string;
  sender_identity_id?: string; // Links to ChannelIdentity to show WhatsApp/SMS origin
  content: string; 
  permissions: MessagePermissions;
  expires_at?: string; 
  retention_policy: RetentionPolicy;
  view_limit?: number;
  read_at?: string;
}

// Actionable Objects tracking real-world state natively inside chat
export interface OsBusinessObject extends BaseTimelineItem {
  type: 'business_object';
  object_type: 'order' | 'payment' | 'agreement' | 'dispute' | 'task' | 'reminder' | 'deal_offer' | 'snapshot';
  source_message_id?: string;
  created_by: string;
  state_snapshot_hash?: string; // Feature 18
  payload: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'locked';
}
