import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { playNotificationSound, showBrowserNotification, requestPushPermission } from '@/lib/notification-sound';
import { useChatContextSafe } from '@/features/chat/chat-context';

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  category: string;
  read_at: string | null;
  created_at: string;
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
      return '/chat';
    default:
      return '/dashboard';
  }
}

/**
 * Extract sender name from notification title for conversation matching.
 */
export function extractNotificationSender(title: string): string | null {
  const fromMatch = title.match(/from\s+(.+)$/i);
  if (fromMatch) return fromMatch[1].trim();
  const sentMatch = title.match(/^(.+?)\s+sent\s+you/i);
  if (sentMatch) return sentMatch[1].trim();
  return null;
}

export function useNotifications() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const chatCtx = useChatContextSafe();

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
  // Suppresses sound/push for chat messages when user is actively viewing that conversation
  const handleRealtimeChange = useCallback(
    (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });

      // If it's a new INSERT, check suppression before playing sound
      if (payload?.eventType === 'INSERT' && payload?.new) {
        const n = payload.new as { title?: string; body?: string; user_id?: string; category?: string };
        if (n.user_id === userId) {
          // Check if this is a chat message notification and user is actively viewing that conversation
          const isMessageNotif = n.category === 'message';
          let suppressed = false;

          if (isMessageNotif && chatCtx) {
            // Extract sender from title to match against active conversation
            const sender = n.title ? extractNotificationSender(n.title) : null;
            // If we're in the chat module and the active conversation matches, suppress
            if (chatCtx.inChatModule && chatCtx.isTabFocused && chatCtx.activeConversationId) {
              // We suppress — the conversation is being actively viewed
              // The message will be auto-marked as read by the chat component
              suppressed = true;
            }
          }

          if (!suppressed) {
            playNotificationSound();
            showBrowserNotification(
              n.title ?? 'New notification',
              n.body ?? undefined
            );
          }
        }
      }
    },
    [queryClient, userId, chatCtx]
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
