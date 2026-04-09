// ─── useTyping ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { setTyping } from '../api/chat';
import { useChatStore } from '@/lib/chat-store';

const STOP_DELAY_MS = 2_500;

export function useTyping(roomId: string | null) {
  const { userId } = useAuth();
  const setTypingUsers = useChatStore((s) => s.setTypingUsers);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const startTyping = useCallback(() => {
    if (!roomId || !userId) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      setTyping(roomId, true).catch(() => {});
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      setTyping(roomId, false).catch(() => {});
    }, STOP_DELAY_MS);
  }, [roomId, userId]);

  const stopTyping = useCallback(() => {
    if (!roomId || !userId) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      setTyping(roomId, false).catch(() => {});
    }
  }, [roomId, userId]);

  // Subscribe to typing state in current room
  useEffect(() => {
    if (!roomId || !userId) return;

    const ch = supabase
      .channel(`chat-typing-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_typing_state',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          // Re-fetch typing users (simpler than delta-merging)
          supabase
            .from('chat_typing_state' as never)
            .select('user_id')
            .eq('room_id', roomId)
            .eq('is_typing', true)
            .gt('expires_at', new Date().toISOString())
            .then(({ data }) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ids = ((data ?? []) as any[])
                .map((r: { user_id: string }) => r.user_id)
                .filter((id: string) => id !== userId);
              setTypingUsers(roomId, ids);
            });
        },
      )
      .subscribe();

    return () => {
      stopTyping();
      supabase.removeChannel(ch);
    };
  }, [roomId, userId, setTypingUsers, stopTyping]);

  return { startTyping, stopTyping };
}
