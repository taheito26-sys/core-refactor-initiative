// ─── useRoomMessages ─────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  getMessages, sendMessage, editMessage, deleteMessage,
  markRoomRead, addReaction, removeReaction, linkAttachmentToMessage, getRoomClearedAt,
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

  const messages = useMemo(() => {
    const data = query.data ?? [];
    if (!roomId) return data;
    const clearedAt = getRoomClearedAt(roomId);
    if (!clearedAt) return data;
    const cutoff = new Date(clearedAt).getTime();
    return data.filter((m) => new Date(m.created_at).getTime() > cutoff);
  }, [query.data, roomId]);

  // mark read when room becomes active
  useEffect(() => {
    if (!roomId || !userId) return;
    markRoomRead(roomId).catch(() => {});
    clearUnread(roomId);
  }, [roomId, userId, clearUnread]);

  // ── realtime subscription (messages + receipts) ───────────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    const ch = supabase
      .channel(`chat-room-${roomId}`)
      // Messages
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const msg = (payload.new ?? payload.old) as ChatMessage;
          if (!msg?.id) return;

          qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) => {
            if (!prev) return prev;
            if (payload.eventType === 'INSERT') {
              const byId    = prev.findIndex((m) => m.id === msg.id);
              const byNonce = msg.client_nonce
                ? prev.findIndex((m) => m.client_nonce === msg.client_nonce)
                : -1;

              if (byId !== -1) {
                return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
              }
              if (byNonce !== -1) {
                return prev.map((m) => (m.client_nonce === msg.client_nonce ? { ...msg } : m));
              }
              return [...prev, { ...msg, receipt_status: 'sent' as const }];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m));
            }
            if (payload.eventType === 'DELETE') {
              return prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true } : m));
            }
            return prev;
          });

          if (payload.eventType === 'INSERT' && msg.sender_id !== userId) {
            markRoomRead(roomId, msg.id).catch(() => {});
          }
        },
      )
      // Receipts — update tick marks in real time (WhatsApp-style)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_message_receipts', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const receipt = payload.new as { message_id: string; status: string; user_id: string } | undefined;
          if (!receipt?.message_id) return;

          qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) => {
            if (!prev) return prev;
            return prev.map((m) => {
              if (m.id !== receipt.message_id) return m;
              // Ignore the sender's own receipt — only other users' receipts matter
              if (receipt.user_id === m.sender_id) return m;
              // Only upgrade status: sent → delivered → read
              const priority = { sent: 0, delivered: 1, read: 2 };
              const currentP = priority[m.receipt_status as keyof typeof priority] ?? -1;
              const newP = priority[receipt.status as keyof typeof priority] ?? -1;
              if (newP > currentP) {
                return { ...m, receipt_status: receipt.status as ChatMessage['receipt_status'] };
              }
              return m;
            });
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [roomId, userId, qc]);

  // ── send ─────────────────────────────────────────────────────────────────
  const send = useMutation({
    // IMPORTANT: mutationFn receives the same `input` object as onMutate.
    // clientNonce must already be set on input so the RPC stores it and
    // realtime dedup can match by nonce. Callers MUST include clientNonce.
    mutationFn: (input: SendMessageInput) => sendMessage({
      ...input,
      clientNonce: input.clientNonce!, // guaranteed by onMutate / callers
    }),
    onMutate: async (input) => {
      if (!roomId || !userId) return;
      // nonce must come from caller — do not generate here so mutationFn
      // and onMutate always share the same value.
      const nonce = input.clientNonce!;
      if (!nonce) {
        console.error('[useRoomMessages] send.mutate called without clientNonce — will cause duplicates');
      }
      // Optimistic insert
      const optimistic = {
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
        _optimistic: true,
        _pending: true,
        _failed: false,
      } as ChatMessage;
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
    onSuccess: async (confirmed, input, ctx) => {
      if (!roomId || !ctx) return;
      qc.setQueryData<ChatMessage[]>(MESSAGES_KEY(roomId), (prev) =>
        prev?.map((m) => (m.client_nonce === ctx.nonce ? confirmed : m)),
      );
      // Link attachment to message if one was provided
      if (input.attachmentId && confirmed?.id) {
        try {
          await linkAttachmentToMessage(input.attachmentId, confirmed.id);
        } catch (err) {
          console.warn('[useRoomMessages] failed to link attachment', err);
        }
      }
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
    messages,
    isLoading: query.isLoading,
    isError: query.isError,
    send,
    edit,
    delete: del,
    react,
    refetch: query.refetch,
  };
}
