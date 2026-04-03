/* ═══════════════════════════════════════════════════════════════
   Chat Realtime Hook — Supabase subscriptions for messages, typing, presence
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useChatStore } from '@/lib/chat-store';
import { shouldSuppressMessage } from './useChatAttention';
import { playNotificationSound, showBrowserNotification } from '@/lib/notification-sound';

interface RealtimeOptions {
  /** All relationship IDs the user participates in */
  relationshipIds: string[];
}

/**
 * Manages all Supabase realtime subscriptions for the chat system.
 * - merchant_messages INSERT → new message handling + suppression logic
 * - Typing presence per active conversation
 * - Invalidates React Query caches
 */
export function useChatRealtime({ relationshipIds }: RealtimeOptions) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const incrementUnread = useChatStore((s) => s.incrementUnread);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Message realtime subscription ──────────────────────────────
  useEffect(() => {
    if (!userId || relationshipIds.length === 0) return;

    const channel = supabase
      .channel('chat-messages-rt')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'merchant_messages',
        },
        (payload) => {
          const msg = payload.new as {
            id: string;
            relationship_id: string;
            sender_id: string;
            content: string;
            created_at: string;
          };

          // Only process messages for relationships we're in
          if (!relationshipIds.includes(msg.relationship_id)) return;

          // Invalidate the query cache so UI refreshes
          queryClient.invalidateQueries({ queryKey: ['unified-chat'] });

          // If message is from us, skip unread logic
          if (msg.sender_id === userId) return;

          // Check suppression: if user is actively viewing this conversation
          if (shouldSuppressMessage(msg.relationship_id)) {
            // Message is visible — mark as read immediately via DB
            supabase
              .from('merchant_messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', msg.id)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
              });
            return;
          }

          // Not suppressed — increment unread count
          incrementUnread(msg.relationship_id);

          // Play notification sound (only if app blurred or different conversation)
          const state = useChatStore.getState();
          if (!state.attention.appFocused || state.activeConversationId !== msg.relationship_id) {
            playNotificationSound();
            showBrowserNotification(
              'New message',
              { body: msg.content.startsWith('||VOICE||') ? '🎤 Voice message' : msg.content.slice(0, 80) }
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'merchant_messages',
        },
        () => {
          // Read receipts or edits — just refresh
          queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, relationshipIds, queryClient, incrementUnread]);

  // ── Typing presence (per active conversation) ──────────────────
  const setTyping = useChatStore((s) => s.setTyping);

  useEffect(() => {
    // Cleanup previous typing channel
    if (typingChannelRef.current) {
      supabase.removeChannel(typingChannelRef.current);
      typingChannelRef.current = null;
    }

    if (!activeConversationId || !userId) return;

    const channel = supabase.channel(`typing:${activeConversationId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const typing = Object.keys(state).filter((k) => k !== userId);
        setTyping(activeConversationId, typing);
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      if (typingChannelRef.current) {
        supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
    };
  }, [activeConversationId, userId, setTyping]);

  // ── Signal typing (call this when user types in composer) ──────
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signalTyping = useCallback(() => {
    if (!typingChannelRef.current || !userId) return;

    typingChannelRef.current.track({ typing: true });

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      typingChannelRef.current?.untrack();
    }, 1800);
  }, [userId]);

  return { signalTyping };
}
