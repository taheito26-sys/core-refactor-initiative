// ─── usePresence ───────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { getPresence, setPresence } from '../api/chat';
import { useChatStore } from '@/lib/chat-store';
import { usePrivacySettings } from './usePrivacySettings';

const HEARTBEAT_MS = 30_000;

export function usePresence() {
  const { userId } = useAuth();
  const setPresenceStore = useChatStore((s) => s.setPresence);
  const rooms = useChatStore((s) => s.rooms);
  const { settings } = usePrivacySettings();

  // Announce own presence and keep alive
  useEffect(() => {
    if (!userId) return;
    const currentStatus = settings.invisible_mode ? 'offline' : 'online';
    setPresenceStore(userId, currentStatus);
    setPresence(currentStatus).catch(() => {});

    const hb = setInterval(() => {
      const nextStatus = settings.invisible_mode ? 'offline' : 'online';
      setPresenceStore(userId, nextStatus);
      setPresence(nextStatus).catch(() => {});
    }, HEARTBEAT_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setPresenceStore(userId, 'away');
        setPresence('away').catch(() => {});
      } else {
        const nextStatus = settings.invisible_mode ? 'offline' : 'online';
        setPresenceStore(userId, nextStatus);
        setPresence(nextStatus).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const handleUnload = () => {
      setPresenceStore(userId, 'offline');
      setPresence('offline').catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(hb);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      setPresenceStore(userId, 'offline');
      setPresence('offline').catch(() => {});
    };
  }, [userId, settings.invisible_mode, setPresenceStore]);

  // Seed presence state for direct-chat counterparts so the UI doesn't
  // default everyone to offline until the next realtime event arrives.
  useEffect(() => {
    if (!userId) return;

    const ids = Array.from(new Set(
      rooms
        .map((room) => room.other_user_id)
        .filter((id): id is string => Boolean(id) && id !== userId),
    ));

    if (ids.length === 0) return;

    let cancelled = false;
    getPresence(ids)
      .then((rows) => {
        if (cancelled) return;

        const now = Date.now();
        const seen = new Set<string>();

        for (const row of rows) {
          seen.add(row.user_id);
          const updatedAt = Date.parse(row.updated_at || row.last_seen_at);
          const isFresh = Number.isFinite(updatedAt) && now - updatedAt < HEARTBEAT_MS * 2;
          const effectiveStatus =
            row.status === 'online' && !isFresh ? 'away' : row.status;
          setPresenceStore(row.user_id, effectiveStatus);
        }

        for (const id of ids) {
          if (!seen.has(id)) {
            setPresenceStore(id, 'offline');
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [rooms, userId, setPresenceStore]);

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
