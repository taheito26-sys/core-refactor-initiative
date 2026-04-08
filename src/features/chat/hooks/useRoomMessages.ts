// ─── useRoomMessages ─────────────────────────────────────────────────────
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  getMessages, sendMessage, editMessage, deleteMessage,
  markRoomRead, addReaction, removeReaction,
} from '../api/chat';
import { useChatStore } from '@/lib/chat-store';
import type { ChatMessage, SendMessageInput } from '../types';

export const MESSAGES_KEY = (roomId: string) => ['chat', 'messages', roomId];

export function useRoomMessages(roomId: string | null) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const clearUnread = useChatStore((s) => s.clearUnread);

  // ── fetch ────────────────────────────────────────────────────────────────
  const query = useQuery({
    queryKey: MESSAGES_KEY(roomId!),
    queryFn:  () => getMessages(roomId!, 60),
    enabled:  !!roomId && !!userId,
    staleTime: 10_000,
  });

  // mark read when room becomes active
  useEffect(() => {
    if (!roomId || !userId) return;
    markRoomRead(roomId).catch(() => {});
    clearUnread(roomId);
  }, [roomId, userId, clearUnread]);

  // ── realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    const ch = supabase
      .channel(`chat-messages-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const msg = (payload.new ?? payload.old) as ChatMessage;
          if (!msg?.id) return;

          qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) => {
            if (!prev) return prev;
            if (payload.eventType === 'INSERT') {
              // dedupe (optimistic might already be there by client_nonce)
              const exists = prev.some(
                (m) => m.id === msg.id || (msg.client_nonce && m.client_nonce === msg.client_nonce),
              );
              if (exists) {
                // replace optimistic with confirmed
                return prev.map((m) =>
                  m.client_nonce === msg.client_nonce ? { ...msg } : m,
                );
              }
              return [...prev, msg];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
            }
            if (payload.eventType === 'DELETE') {
              return prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true } : m));
            }
            return prev;
          });

          // auto-mark read if this room is active
          if (payload.eventType === 'INSERT' && msg.sender_id !== userId) {
            markRoomRead(roomId, msg.id).catch(() => {});
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [roomId, userId, qc]);

  // ── send ─────────────────────────────────────────────────────────────────
  const send = useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(input),
    onMutate: async (input) => {
      if (!roomId || !userId) return;
      const nonce = input.clientNonce ?? crypto.randomUUID();
      // Optimistic insert
      const optimistic: ChatMessage = {
        id: `opt-${nonce}`,
        room_id: roomId,
        sender_id: userId,
        type: input.type ?? 'text',
        content: input.content,
        metadata: input.metadata ?? {},
        reply_to_id: input.replyToId ?? null,
        forwarded_from_id: null,
        client_nonce: nonce,
        is_edited: false,
        edited_at: null,
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        deleted_for_sender: false,
        expires_at: input.expiresAt ?? null,
        view_once: input.viewOnce ?? false,
        viewed_by: [],
        watermark_text: input.watermarkText ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _optimistic: true as any,
        _pending: true as any,
        _failed: false as any,
      };
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev ? [...prev, optimistic] : [optimistic],
      );
      return { nonce };
    },
    onError: (_err, input, ctx) => {
      // mark as failed
      if (!roomId || !ctx) return;
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev?.map((m) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          m.client_nonce === ctx.nonce ? { ...m, _failed: true as any } : m,
        ),
      );
    },
    onSuccess: (confirmed, _input, ctx) => {
      if (!roomId || !ctx) return;
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev?.map((m) => (m.client_nonce === ctx.nonce ? confirmed : m)),
      );
    },
  });

  // ── edit ──────────────────────────────────────────────────────────────────
  const edit = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      editMessage(messageId, content),
    onSuccess: (updated) => {
      if (!roomId) return;
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev?.map((m) => (m.id === updated.id ? updated : m)),
      );
    },
  });

  // ── delete ────────────────────────────────────────────────────────────────
  const del = useMutation({
    mutationFn: ({ messageId, forEveryone }: { messageId: string; forEveryone?: boolean }) =>
      deleteMessage(messageId, forEveryone),
    onMutate: async ({ messageId, forEveryone }) => {
      if (!roomId) return;
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev?.map((m) =>
          m.id === messageId
            ? forEveryone
              ? { ...m, is_deleted: true, content: '' }
              : { ...m, deleted_for_sender: true }
            : m,
        ),
      );
    },
  });

  // ── reactions ─────────────────────────────────────────────────────────────
  const react = useMutation({
    mutationFn: ({ messageId, emoji, remove }: { messageId: string; emoji: string; remove?: boolean }) =>
      remove ? removeReaction(messageId, emoji) : addReaction(messageId, emoji),
  });

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    send,
    edit,
    delete: del,
    react,
    refetch: query.refetch,
  };
}
