import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { playNotificationSound, requestPushPermission, showBrowserNotification } from '@/lib/notification-sound';
import { buildNotificationNavigationTarget } from '@/lib/notification-router';
import { mapNotificationRowToModel, normalizeNotificationCategory, type AppNotification, type NotificationCategoryGroup, type NotificationRow } from '@/types/notifications';
import { useChatStore, isViewingConversationMessage } from '@/lib/chat-store';

export type Notification = AppNotification;

function applyReadStateToCache(queryClient: ReturnType<typeof useQueryClient>, ids: string[], readAt: string) {
  queryClient.setQueriesData(
    { queryKey: ['notifications'] },
    (prev: Notification[] | undefined) => {
      if (!prev) return prev;
      const idSet = new Set(ids);
      return prev.map((n) => (idSet.has(n.id) ? { ...n, read_at: readAt } : n));
    },
  );
}

interface UseNotificationsOptions {
  shouldSuppressRealtimeNotification?: (notification: Notification) => boolean;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [hasLiveNotificationChannel, setHasLiveNotificationChannel] = useState(false);

  const query = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, category, read_at, created_at, conversation_id, message_id, entity_type, entity_id, anchor_id, actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => mapNotificationRowToModel(row as NotificationRow));
    },
    enabled: !!userId,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (userId) requestPushPermission();
  }, [userId]);

  const handleRealtimeInsert = useCallback((notification: Notification) => {
    const shouldSuppressViaStore = notification.target.kind === 'chat_message'
      && Boolean(notification.target.conversationId)
      && isViewingConversationMessage(useChatStore.getState(), notification.target.conversationId!);
    const shouldSuppress = shouldSuppressViaStore || options.shouldSuppressRealtimeNotification?.(notification);
    if (shouldSuppress) return;

    playNotificationSound();
    const nav = buildNotificationNavigationTarget(notification);
    showBrowserNotification(notification.title ?? 'New notification', {
      body: notification.body ?? undefined,
      tag: `notif-${notification.id}-${notification.target.kind}-${notification.target.entityId ?? notification.target.conversationId ?? 'generic'}`,
      onClick: () => {
        if (nav.pendingChatNav) useChatStore.getState().setPendingNav(nav.pendingChatNav);
        window.location.assign(`${nav.pathname}${nav.search ?? ''}`);
      },
    });
  }, [options]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notif-badge-rt-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload: any) => {
        queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        if (payload?.eventType !== 'INSERT' || !payload?.new) return;
        const row = payload.new as NotificationRow & { user_id?: string };
        if (row.user_id !== userId) return;
        handleRealtimeInsert(mapNotificationRowToModel(row));
      })
      .subscribe((status) => {
        setHasLiveNotificationChannel(status === 'SUBSCRIBED');
      });

    return () => {
      setHasLiveNotificationChannel(false);
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient, handleRealtimeInsert]);

  const unreadNotificationCount = useMemo(
    () => (query.data ?? []).filter((n) => !n.read_at).length,
    [query.data],
  );

  const unreadByCategory = useMemo(() => {
    const counts: Record<NotificationCategoryGroup, number> = {
      all: unreadNotificationCount,
      approval: 0,
      deal: 0,
      invite: 0,
      message: 0,
      order: 0,
      system: 0,
    };
    for (const n of (query.data ?? [])) {
      if (n.read_at) continue;
      counts[normalizeNotificationCategory(n.category)] += 1;
    }
    return counts;
  }, [query.data, unreadNotificationCount]);

  return {
    ...query,
    unreadCount: unreadNotificationCount,
    unreadNotificationCount,
    unreadByCategory,
    hasLiveNotificationChannel,
  };
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const readAt = new Date().toISOString();
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', id);
      if (error) throw error;
      return { id, readAt };
    },
    onMutate: async (id: string) => {
      const readAt = new Date().toISOString();
      applyReadStateToCache(queryClient, [id], readAt);
      return { id, readAt };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const readAt = new Date().toISOString();
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).in('id', ids).is('read_at', null);
      if (error) throw error;
      return { ids, readAt };
    },
    onMutate: async (ids: string[]) => {
      const readAt = new Date().toISOString();
      applyReadStateToCache(queryClient, ids, readAt);
      return { ids, readAt };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId!).is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
