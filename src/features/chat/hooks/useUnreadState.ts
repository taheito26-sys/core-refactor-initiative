import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useChatStore, isViewingConversationMessage } from '@/lib/chat-store';

export function useUnreadState(roomId: string | null) {
  const { userId, merchantProfile } = useAuth();
  const actorId = merchantProfile?.merchant_id || userId;
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const attention = useChatStore((s) => s.attention);
  const chatState = useMemo(() => ({ activeConversationId, attention }), [activeConversationId, attention]);

  const { data: roomMessages } = useQuery({
    queryKey: ['os-unread-first-message', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('os_messages')
        .select('id,created_at,read_at,sender_merchant_id')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 10_000,
  });

  const unreadIncoming = useMemo(() => {
    return (roomMessages ?? []).filter((m: any) => !m.read_at && m.sender_merchant_id !== actorId);
  }, [roomMessages, actorId]);

  const shouldSuppressUnreadIncrement = useMemo(
    () => Boolean(roomId) && isViewingConversationMessage(chatState, roomId!),
    [chatState, roomId],
  );

  const roomUnreadCount = shouldSuppressUnreadIncrement ? 0 : unreadIncoming.length;
  const firstUnreadMessageId = unreadIncoming[0]?.id ?? null;
  const lastUnreadMessageId = unreadIncoming[unreadIncoming.length - 1]?.id ?? null;

  return { roomUnreadCount, firstUnreadMessageId, lastUnreadMessageId, shouldSuppressUnreadIncrement };
}
