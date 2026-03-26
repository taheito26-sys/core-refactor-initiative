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
  object_type: 'order' | 'payment' | 'agreement' | 'dispute' | 'task' | 'deal_offer' | 'snapshot';
  source_message_id?: string;
  created_by: string;
  state_snapshot_hash?: string; // Feature 18
  payload: any;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'locked';
}

// ── Mock Data Definitions ─────────────────────────────────

export const MOCK_OS_USER: OsUser = {
  id: 'user-me-123',
  global_role: 'admin',
  trust_score: { value: 98, factors: ['Identity Verified'] },
  identities: [{ id: 'id-web-1', provider_type: 'Web', provider_uid: 'dev@local', confidence_level: 'certain' }]
};

export const MOCK_OS_ROOMS: OsRoom[] = [
  {
    id: 'room-secure-deal-1',
    name: 'Deal Negotiation: Alpha',
    type: 'deal',
    lane: 'Deals',
    security_policies: {
      disable_forwarding: true, disable_copy: true, disable_export: true, watermark: true,
    },
    retention_policy: '30d'
  },
  {
    id: 'room-support-ticket-8',
    name: 'Customer Support: 8812',
    type: 'standard',
    lane: 'Customers',
    security_policies: {
      disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false,
    },
    retention_policy: 'indefinite'
  },
  {
    id: 'room-team-general',
    name: 'Engineering Team',
    type: 'standard',
    lane: 'Team',
    security_policies: {
      disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false,
    },
    retention_policy: 'indefinite'
  }
];

export const MOCK_TIMELINE_ITEMS: (OsMessage | OsBusinessObject)[] = [
  {
    id: 'msg-1', type: 'message', room_id: 'room-secure-deal-1',
    sender_id: 'user-abu3awni', sender_identity_id: 'id-whatsapp-abu',
    content: 'Here are the initial terms we requested via WhatsApp.',
    permissions: { forwardable: false, exportable: false, copyable: false, ai_readable: false },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 500000).toISOString()
  },
  {
    id: 'bo-1', type: 'business_object', room_id: 'room-secure-deal-1',
    object_type: 'deal_offer', created_by: 'user-abu3awni', source_message_id: 'msg-1',
    payload: { amount: 50000, asset: 'USDT', rate: 3.65 }, status: 'pending',
    created_at: new Date(Date.now() - 400000).toISOString()
  },
  {
    id: 'msg-2', type: 'message', room_id: 'room-support-ticket-8',
    sender_id: 'cust-123', sender_identity_id: 'id-sms-123',
    content: 'I need tracking info please.',
    permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 300000).toISOString()
  }
];

export const MOCK_IDENTITIES: Record<string, ChannelIdentity> = {
  'id-whatsapp-abu': { id: 'id-whatsapp-abu', provider_type: 'WhatsApp', provider_uid: '+974XX', confidence_level: 'certain' },
  'id-sms-123': { id: 'id-sms-123', provider_type: 'SMS', provider_uid: '+1555XX', confidence_level: 'probable' },
};
