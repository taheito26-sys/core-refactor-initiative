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
  display_name?: string;
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
  message_type?: string;
}

export interface OsUser {
  id: string;
  global_role: GlobalRole;
  trust_score: { value: number; factors: string[] };
  identities: ChannelIdentity[];
  tags?: string[]; // Added for merchant management
}

export interface OsRoom {
  id: string;
  name: string;
  type: RoomType;
  lane: InboxLane;
  security_policies: SecurityPolicies;
  retention_policy: RetentionPolicy;
  unread_count?: number;
  trade_id?: string; // Link to secure trade
  order_id?: string; // Link to tracker order
  tags?: string[];   // Room-level tags
}

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
  sender_identity_id?: string; 
  content: string; 
  message_type?: string;
  permissions: MessagePermissions;
  expires_at?: string; 
  retention_policy: RetentionPolicy;
  view_limit?: number;
  read_at?: string;
}

export interface OsBusinessObject extends BaseTimelineItem {
  type: 'business_object';
  object_type: 'order' | 'payment' | 'agreement' | 'dispute' | 'task' | 'deal_offer' | 'snapshot';
  source_message_id?: string;
  created_by: string;
  state_snapshot_hash?: string; 
  payload: any;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'locked';
}

// All mock data has been removed — production uses real database queries only.
