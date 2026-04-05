import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface ActivityItem {
  id: string;
  type: 'deal' | 'notification' | 'invite';
  title: string;
  description: string | null;
  timestamp: string;
}

/**
 * ISSUE 4 FIX: The Supabase realtime channel previously subscribed to ALL
 * rows in the notifications table with no filter.  Every notification for
 * every user in the system would trigger a cache invalidation for the current
 * user, causing unnecessary network traffic and — if Supabase row-level
 * replication is not restricted — a potential data-visibility leak.
 *
 * Fix: add `filter: \`user_id=eq.${userId}\`` so Supabase only sends
 * change events that belong to the current user.
 */
export function useRecentActivity() {
  const { userId, merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id;
  const queryClient = useQueryClient();

  // ISSUE 4 FIX: scoped filter — only listen to this user's notifications
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`recent-activity-rt-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,   // ← was missing; was listening to all users
        },
        () => { queryClient.invalidateQueries({ queryKey: ['recent-activity'] }); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  return useQuery({
    queryKey: ['recent-activity', userId, merchantId],
    queryFn: async (): Promise<ActivityItem[]> => {
      const items: ActivityItem[] = [];

      // Recent notifications
      if (userId) {
        const { data: notifications } = await supabase
          .from('notifications')
          .select('id, title, body, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (notifications) {
          for (const n of notifications) {
            items.push({
              id: n.id,
              type: 'notification',
              title: n.title,
              description: n.body,
              timestamp: n.created_at,
            });
          }
        }
      }

      // Recent invites
      if (merchantId) {
        const { data: invites } = await supabase
          .from('merchant_invites')
          .select('id, from_merchant_id, status, created_at')
          .eq('to_merchant_id', merchantId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (invites) {
          for (const inv of invites) {
            items.push({
              id: inv.id,
              type: 'invite',
              title: `Invite from ${inv.from_merchant_id}`,
              description: `Status: ${inv.status}`,
              timestamp: inv.created_at,
            });
          }
        }
      }

      // Sort by timestamp descending
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return items.slice(0, 10);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}
