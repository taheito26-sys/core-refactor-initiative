export type NotificationTargetKind =
  | 'chat_message'
  | 'order'
  | 'deal'
  | 'stock'
  | 'settlement'
  | 'approval'
  | 'invite'
  | 'system';

export interface NotificationTargetPayload {
  kind: NotificationTargetKind;
  notificationId: string;
  conversationId?: string | null;
  messageId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  anchorId?: string | null;
  actionUrl?: string | null;
  dedupeKey?: string | null;
  /** New precise routing fields */
  actorId?: string | null;
  targetPath?: string | null;
  targetTab?: string | null;
  targetFocus?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  category: string;
  read_at: string | null;
  created_at: string;
  conversation_id?: string | null;
  message_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  anchor_id?: string | null;
  action_url?: string | null;
  dedupe_key?: string | null;
  sender_id?: string | null;
  /** New precise routing fields from DB */
  actor_id?: string | null;
  target_path?: string | null;
  target_tab?: string | null;
  target_focus?: string | null;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
}

export interface AppNotification extends NotificationRow {
  target: NotificationTargetPayload;
}

export type NotificationCategoryGroup =
  | 'all'
  | 'deal'
  | 'order'
  | 'invite'
  | 'approval'
  | 'message'
  | 'system';

export function normalizeNotificationCategory(category: string): NotificationCategoryGroup {
  if (category === 'network' || category === 'invite') return 'invite';
  if (category === 'merchant' || category === 'deal') return 'deal';
  if (category === 'message') return 'message';
  if (category === 'order') return 'order';
  if (category === 'approval') return 'approval';
  return 'system';
}

export function inferTargetKind(row: NotificationRow): NotificationTargetKind {
  if (row.conversation_id || row.category === 'message') return 'chat_message';
  if (row.entity_type === 'order' || row.category === 'order') return 'order';
  if (row.entity_type === 'deal' || row.category === 'deal' || row.category === 'merchant') return 'deal';
  if (row.entity_type === 'stock') return 'stock';
  if (row.entity_type === 'settlement' || row.category === 'settlement') return 'settlement';
  if (row.entity_type === 'approval' || row.category === 'approval') return 'approval';
  if (row.entity_type === 'invite' || row.category === 'invite' || row.category === 'network') return 'invite';
  return 'system';
}

export function mapNotificationRowToModel(row: NotificationRow): AppNotification {
  return {
    ...row,
    target: {
      kind: inferTargetKind(row),
      notificationId: row.id,
      conversationId: row.conversation_id ?? null,
      messageId: row.message_id ?? null,
      entityType: row.entity_type ?? null,
      entityId: row.entity_id ?? null,
      anchorId: row.anchor_id ?? null,
      actionUrl: row.action_url ?? null,
      dedupeKey: row.dedupe_key ?? null,
      actorId: row.actor_id ?? null,
      targetPath: row.target_path ?? null,
      targetTab: row.target_tab ?? null,
      targetFocus: row.target_focus ?? null,
      targetEntityType: row.target_entity_type ?? null,
      targetEntityId: row.target_entity_id ?? null,
    },
  };
}
