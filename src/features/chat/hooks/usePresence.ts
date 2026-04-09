// ─── usePresence ───────────────────────────────────────────────────────────
import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { setPresence } from '../api/chat';
import { useChatStore } from '@/lib/chat-store';

const HEARTBEAT_MS = 30_000;

export function usePresence() {
  const { userId } = useAuth();
  const setPresenceStore = useChatStore((s) => s.setPresence);

  // Announce own presence and keep alive
  useEffect(() => {
    if (!userId) return;
    setPresence('online').catch(() => {});

    const hb = setInterval(() => {
      setPresence('online').catch(() => {});
    }, HEARTBEAT_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setPresence('away').catch(() => {});
      } else {
        setPresence('online').catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const handleUnload = () => { setPresence('offline').catch(() => {}); };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(hb);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      setPresence('offline').catch(() => {});
    };
  }, [userId]);

  // Subscribe to presence updates
  useEffect(() => {
    if (!userId) return;

    const ch = supabase
      .channel('chat-presence-global')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_presence' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = (payload.new ?? payload.old) as any;
          if (row?.user_id) {
            setPresenceStore(row.user_id, row.status ?? 'offline');
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [userId, setPresenceStore]);
}
