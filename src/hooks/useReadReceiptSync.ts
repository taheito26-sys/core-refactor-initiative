/**
 * useReadReceiptSync — Cross-device read receipt synchronization.
 *
 * Listens to realtime UPDATE events on the notifications table for the
 * current user. When read_at is set on another device, the local cache
 * is updated instantly so badges and unread counts stay in sync.
 *
 * This hook should be mounted once at the app level (e.g., in AppLayout).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { Notification } from '@/hooks/useNotifications';

export function useReadReceiptSync() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`read-sync-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.read_at) return;

          // Apply the read state to the local cache immediately
          queryClient.setQueriesData(
            { queryKey: ['notifications'] },
            (prev: Notification[] | undefined) => {
              if (!prev) return prev;
              return prev.map((n) =>
                n.id === updated.id && !n.read_at
                  ? { ...n, read_at: updated.read_at }
                  : n
              );
            },
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
