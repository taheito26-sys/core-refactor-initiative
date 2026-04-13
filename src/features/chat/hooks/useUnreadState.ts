// ─── useUnreadState ──────────────────────────────────────────────────────
import { useMemo } from 'react';
import { useChatStore } from '@/lib/chat-store';

/** Returns the unread count for a given room from the store. */
export function useUnreadState(roomId: string | null) {
  const counts = useChatStore((s) => s.unreadCounts);
  const count = useMemo(
    () => (roomId ? (counts[roomId] ?? 0) : 0),
    [roomId, counts],
  );
  return { unreadCount: count };
}
