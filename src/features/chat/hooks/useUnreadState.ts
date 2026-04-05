import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useChatStore, isViewingConversationMessage } from '@/lib/chat-store';

/**
 * ISSUE 5 FIX: The previous query fetched up to 2 000 rows — every message
 * in the room — then filtered them in JavaScript to find unread ones.
 * On busy channels this transferred megabytes of data on every room open and
 * caused noticeable lag.
 *
 * Fix: push the two filters (unread + not-from-self) into the Supabase query
 * so the database returns only the rows that actually matter.  The limit is
 * reduced to 50 — more than enough to display an unread divider and badge.
 */
export function useUnreadState(roomId: string | null) {
  const { userId, merchantProfile } = useAuth();
  const actorId = merchantProfile?.merchant_id || userId;
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const attention = useChatStore((s) => s.attention);
  const chatState = useMemo(() => ({ activeConversationId, attention }), [activeConversationId, attention]);

  const { data: unreadMessages } = useQuery({
    queryKey: ['os-unread-first-message', roomId, actorId],
    enabled: !!roomId && !!actorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('os_messages')
        .select('id,created_at,read_at,sender_merchant_id')
        .eq('room_id', roomId!)
        // ISSUE 5 FIX: filter server-side — previously fetched ALL 2000 rows
        .is('read_at', null)
        .neq('sender_merchant_id', actorId!)
        .order('created_at', { ascending: true })
        .limit(50);                          // ← was .limit(2000) with JS filter
      if (error) return [];
      return data ?? [];
    },
    staleTime: 10_000,
  });

  const shouldSuppressUnreadIncrement = useMemo(
    () => Boolean(roomId) && isViewingConversationMessage(chatState, roomId!),
    [chatState, roomId],
  );

  const roomUnreadCount = shouldSuppressUnreadIncrement ? 0 : (unreadMessages?.length ?? 0);
  const firstUnreadMessageId = unreadMessages?.[0]?.id ?? null;
  const lastUnreadMessageId = unreadMessages?.[unreadMessages.length - 1]?.id ?? null;

  return { roomUnreadCount, firstUnreadMessageId, lastUnreadMessageId, shouldSuppressUnreadIncrement };
}
