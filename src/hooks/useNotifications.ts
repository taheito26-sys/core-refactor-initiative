import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { playNotificationSound, showBrowserNotification, requestPushPermission } from '@/lib/notification-sound';

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  category: string;
  read_at: string | null;
  created_at: string;
  // Routing metadata for deep linking
  conversation_id?: string | null;
  message_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  anchor_id?: string | null;
}

/** Map notification categories to app routes */
export function notificationRoute(n: Notification): string {
  switch (n.category) {
    case 'deal':
    case 'order':
      return '/trading/orders';
    case 'invite':
    case 'network':
      return '/merchants';
    case 'approval':
      return '/admin/approvals';
    case 'merchant':
      return '/merchants';
    case 'message':
      return '/merchants?tab=chat';
    default:
      return '/dashboard';
  }
}

export function useNotifications() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, category, read_at, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    enabled: !!userId,
    staleTime: 15_000,
  });

  // Track previous unread count to detect new arrivals
  const prevUnreadRef = useRef<number | null>(null);

  // Request push permission on mount
  useEffect(() => {
    if (userId) requestPushPermission();
  }, [userId]);

  // Real-time listener — play sound + push on new notifications
  const handleRealtimeChange = useCallback(
    (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });

      // If it's a new INSERT, play sound and push
      if (payload?.eventType === 'INSERT' && payload?.new) {
        const n = payload.new as { title?: string; body?: string; user_id?: string };
        if (n.user_id === userId) {
          playNotificationSound();
          showBrowserNotification(
            n.title ?? 'New notification',
            n.body ?? undefined
          );
        }
      }
    },
    [queryClient, userId]
  );

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('notif-badge-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        handleRealtimeChange
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, handleRealtimeChange]);

  const unreadCount = (query.data ?? []).filter(n => !n.read_at).length;

  return { ...query, unreadCount };
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId!)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Mark all unread notifications of a specific category as read */
export function useMarkCategoryRead() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (category: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId!)
        .eq('category', category)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
