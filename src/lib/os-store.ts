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

// ── Mock Data Definitions ─────────────────────────────────

export const MOCK_OS_USER: OsUser = {
  id: 'user-me-123',
  global_role: 'admin',
  trust_score: { value: 98, factors: ['Identity Verified'] },
  identities: [{ id: 'id-web-1', provider_type: 'Web', provider_uid: 'dev@local', confidence_level: 'certain' }]
};

export const MOCK_OS_ROOMS: OsRoom[] = [
  {
    id: 'room-personal-1',
    name: 'Family Weekend Planning',
    type: 'standard',
    lane: 'Personal',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false },
    retention_policy: 'indefinite',
    unread_count: 2
  },
  {
    id: 'room-team-1',
    name: 'DevOps & Infrastructure',
    type: 'standard',
    lane: 'Team',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false },
    retention_policy: 'indefinite',
    unread_count: 5
  },
  {
    id: 'room-customer-1',
    name: 'VIP Client #901 - Jassim',
    type: 'standard',
    lane: 'Customers',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: true },
    retention_policy: 'indefinite',
    unread_count: 1
  },
  {
    id: 'room-deal-1',
    name: 'Project Falcon Negotiation',
    type: 'deal',
    lane: 'Deals',
    security_policies: { disable_forwarding: true, disable_copy: true, disable_export: true, watermark: true },
    retention_policy: '30d'
  },
  {
    id: 'room-alert-1',
    name: 'SECURITY ALERTS: CORE',
    type: 'incident',
    lane: 'Alerts',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false },
    retention_policy: 'indefinite',
    unread_count: 12
  },
  {
    id: 'room-archive-1',
    name: 'Q4 2025 Financials',
    type: 'standard',
    lane: 'Archived',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false },
    retention_policy: 'indefinite'
  }
];

export const MOCK_TIMELINE_ITEMS: (OsMessage | OsBusinessObject)[] = [
  // Deal Room
  {
    id: 'msg-d1', type: 'message', room_id: 'room-deal-1',
    sender_id: 'user-extern-3', sender_identity_id: 'id-mail-jassim',
    content: 'Our counter-offer is 2.5% equity + $100k cash.',
    message_type: 'text',
    permissions: { forwardable: false, exportable: false, copyable: false, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 500000).toISOString()
  },
  {
    id: 'msg-ai-1', type: 'message', room_id: 'room-deal-1',
    sender_id: 'system',
    content: '||AI_SUMMARY|| The counter-party has requested equity. This matches typical Project Falcon patterns.',
    message_type: 'ai_summary',
    permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 400000).toISOString()
  },
  {
    id: 'bo-1', type: 'business_object', room_id: 'room-deal-1',
    object_type: 'deal_offer', created_by: 'user-extern-3', source_message_id: 'msg-d1',
    payload: { amount: 100000, equity: '2.5%', currency: 'USD' }, status: 'pending',
    created_at: new Date(Date.now() - 300000).toISOString()
  },
  // Team Room
  {
    id: 'msg-t1', type: 'message', room_id: 'room-team-1',
    sender_id: 'user-me-123',
    content: 'Running the migration script now.',
    message_type: 'text',
    permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 200000).toISOString()
  },
  {
    id: 'msg-app-1', type: 'message', room_id: 'room-team-1',
    sender_id: 'system',
    content: '[[MiniApp: Calculator]] Result: 42. Integration complete.',
    message_type: 'app_output',
    permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date(Date.now() - 100000).toISOString()
  },
  // Personal (Vanish)
  {
    id: 'msg-p1', type: 'message', room_id: 'room-personal-1',
    sender_id: 'user-extern-1', sender_identity_id: 'id-whatsapp-khalid',
    content: '||VANISH|| See you at the airport at 5pm!',
    message_type: 'vanish',
    permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
    retention_policy: 'indefinite', created_at: new Date().toISOString()
  }
];

export const MOCK_IDENTITIES: Record<string, ChannelIdentity> = {
  'id-whatsapp-khalid': { id: 'id-whatsapp-khalid', provider_type: 'WhatsApp', provider_uid: '+97400010001', display_name: 'Khalid Al-Hajri', confidence_level: 'certain' },
  'id-mail-jassim': { id: 'id-mail-jassim', provider_type: 'Email', provider_uid: 'jassim@example.qa', display_name: 'Jassim Al-Thani', confidence_level: 'certain' },
};
