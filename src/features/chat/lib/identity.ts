import type { ChatRoomListItem } from '../types';

type RoomIdentityMetadata = Record<string, unknown>;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveChatUserLabel(
  userId?: string | null,
  candidates: unknown[] = [],
): string {
  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value;
  }

  const fallbackId = asNonEmptyString(userId);
  return fallbackId ? fallbackId.slice(0, 8) : 'Unknown';
}

export function resolveRoomDisplayName(room: Pick<ChatRoomListItem, 'display_name' | 'name' | 'is_direct' | 'other_user_id' | 'other_user_metadata'>): string {
  const meta = (room.other_user_metadata ?? {}) as RoomIdentityMetadata;

  return resolveChatUserLabel(room.other_user_id, [
    room.display_name,
    room.is_direct ? meta.display_name : null,
    room.is_direct ? meta.nickname : null,
    room.name !== 'Direct Message' ? room.name : null,
    room.is_direct && typeof meta.email === 'string' ? meta.email.split('@')[0] : null,
    room.is_direct ? room.other_user_id : null,
    room.name,
    room.is_direct ? 'Direct Message' : 'Room',
  ]);
}

export function resolveRoomAvatar(room: Pick<ChatRoomListItem, 'display_avatar' | 'avatar_url' | 'other_user_metadata' | 'is_direct'>): string | null {
  const meta = (room.other_user_metadata ?? {}) as RoomIdentityMetadata;
  const directAvatar = room.is_direct ? asNonEmptyString(meta.avatar_url) : null;
  return asNonEmptyString(room.display_avatar) ?? directAvatar ?? asNonEmptyString(room.avatar_url);
}
