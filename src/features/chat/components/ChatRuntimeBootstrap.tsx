import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useChatStore } from '@/lib/chat-store';
import { usePresence } from '../hooks/usePresence';

export function ChatRuntimeBootstrap() {
  const { userId, customerProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const setPendingNav = useChatStore((s) => s.setPendingNav);
  const seenIncomingCalls = useRef<Set<string>>(new Set());

  usePresence();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`chat-global-calls-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_calls' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (!row?.id || !row?.room_id) return;
          if (row.initiated_by === userId) return;
          if (row.status !== 'ringing') return;
          if (seenIncomingCalls.current.has(row.id)) return;

          seenIncomingCalls.current.add(row.id);
          setPendingNav({
            conversationId: row.room_id,
            messageId: null,
            notificationId: `incoming-call:${row.id}`,
          });

          const targetPath = customerProfile ? '/c/chat' : '/chat';
          const targetUrl = `${targetPath}?roomId=${row.room_id}`;
          const currentUrl = `${location.pathname}${location.search}`;

          if (currentUrl !== targetUrl) {
            navigate(targetUrl);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerProfile, location.pathname, location.search, navigate, setPendingNav, userId]);

  return null;
}
