/**
 * useRoomMessages
 *
 * BUG 1 FIX: Real-time INSERT subscription — new messages from counterparty
 *            appear instantly without page refresh.
 * BUG 1 FIX: Real-time UPDATE subscription — read_at changes (read receipts)
 *            propagate to the sender's UI immediately.
 * BUG 2 FIX: onError rollback restores optimistic cache snapshot and shows
 *            a toast so users know the send failed.
 */

import { useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getRoomMessages, markMessagesReadUpTo, sendMessage } from '@/features/chat/api/messages';
import { randomUUID } from '@/features/chat/utils/uuid';
import { useAuth } from '@/features/auth/auth-context';
import { setRoomUnreadCountInCache } from '@/features/chat/api/rooms';
import { toast } from 'sonner';

type CacheMsg = Record<string, unknown>;

/** Shape the raw realtime row into the same format getRoomMessages returns */
function normalizeRealtimeRow(row: Record<string, unknown>): CacheMsg {
  return { ...row, body: row.content, sender_name: row.sender_merchant_id };
}

export function useRoomMessages(roomId: string | null) {
  const qc = useQueryClient();
  const { userId, merchantProfile } = useAuth();
  const actorId = merchantProfile?.merchant_id || userId;

  // ── Initial fetch ──────────────────────────────────────────────────────

  const query = useQuery({
    queryKey: ['chat', 'messages', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getRoomMessages(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Fetch failed');
      return res.data || [];
    },
  });

  // ── BUG 1 FIX: Real-time subscription ─────────────────────────────────

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`room-messages-rt-${roomId}`)
      // New messages — append to cache for instant delivery
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'os_messages', filter: `room_id=eq.${roomId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Record<string, unknown>;

          qc.setQueryData(['chat', 'messages', roomId], (old: CacheMsg[] | undefined) => {
            const existing = old ?? [];

            // Already in cache (e.g. from a previous refetch) — skip
            if (existing.some((m) => m.id === row.id)) return existing;

            if (row.sender_merchant_id === actorId) {
              // OWN MESSAGE — BUG A FIX:
              // Previously we skipped own messages here and relied on onSettled
              // to refetch them. But onSettled can race against the Supabase
              // write propagation on read replicas: the refetch returns BEFORE
              // the new row is visible, the optimistic temp message is wiped,
              // and the real message never appears in the window (even though
              // the sidebar picks it up via a separate useRooms subscription).
              //
              // Fix: let the realtime INSERT be the source of truth for own
              // messages too.  Remove any outstanding temp-* optimistic entries
              // (they were placeholders while the RPC was in-flight) and slot
              // in the confirmed server row.
              const withoutTemps = existing.filter(
                (m) => !String(m.id).startsWith('temp-'),
              );
              return [...withoutTemps, normalizeRealtimeRow(row)];
            }

            // Counterparty message — append
            return [...existing, normalizeRealtimeRow(row)];
          });

          // Keep sidebar last-message preview fresh
          qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
        },
      )
      // read_at updates — sender sees ✓✓ turn blue when counterparty reads
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'os_messages', filter: `room_id=eq.${roomId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Record<string, unknown>;
          qc.setQueryData(['chat', 'messages', roomId], (old: CacheMsg[] | undefined) => {
            if (!old) return old;
            return old.map((m) => m.id === row.id ? { ...m, ...row, body: row.content } : m);
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, actorId, qc]);

  // ── Send (BUG 2 FIX: onError restores snapshot) ───────────────��────────

  const send = useMutation({
    mutationFn: async (payload: {
      content: string;
      type?: string;
      bodyJson?: Record<string, unknown>;
      expiresAt?: string | null;
      replyToMessageId?: string | null;
    }) => {
      if (!roomId) throw new Error('No active room');
      const clientNonce = randomUUID();
      const res = await sendMessage({
        roomId,
        clientNonce,
        body: payload.content,
        messageType: payload.type ?? 'text',
        bodyJson: payload.bodyJson,
        expiresAt: payload.expiresAt,
        replyToMessageId: payload.replyToMessageId,
      });
      if (!res.ok) throw new Error(res.error ?? 'Send failed');
      return res.data;
    },

    onMutate: async (newMsg) => {
      await qc.cancelQueries({ queryKey: ['chat', 'messages', roomId] });
      const previous = qc.getQueryData(['chat', 'messages', roomId]);
      qc.setQueryData(['chat', 'messages', roomId], (old: CacheMsg[] | undefined) => [
        ...(old ?? []),
        {
          id: `temp-${Date.now()}`,
          room_id: roomId,
          sender_id: actorId,
          sender_merchant_id: actorId,
          content: newMsg.content,
          body: newMsg.content,
          body_json: newMsg.bodyJson ?? {},
          message_type: newMsg.type ?? 'text',
          status: 'sending',
          created_at: new Date().toISOString(),
          read_at: null,
        },
      ]);
      return { previous };
    },

    // BUG 2 FIX: restore previous cache and alert the user
    onError: (_err, _vars, context: { previous: unknown } | undefined) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(['chat', 'messages', roomId], context.previous);
      }
      toast.error('Message failed to send — please try again');
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    },
  });

  // ── Mark read ──────────────────────────────────────────────────────────

  const read = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await markMessagesReadUpTo(roomId, messageId);
      return res.ok;
    },
    onMutate: async (messageId: string) => {
      if (!roomId) return;
      qc.setQueryData(['chat', 'messages', roomId], (old: CacheMsg[] | undefined) => {
        if (!old) return old;
        const target = old.find((m) => m.id === messageId);
        if (!target) return old;
        const cutoff = new Date(target.created_at as string).getTime();
        const readAt = new Date().toISOString();
        return old.map((m) =>
          new Date(m.created_at as string).getTime() <= cutoff && !m.read_at
            ? { ...m, read_at: readAt }
            : m,
        );
      });
      setRoomUnreadCountInCache(qc, roomId, 0);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    },
  });

  // ── Delete for me (local optimistic — BUG 3 partial fix) ──────────────

  const deleteForMe = useCallback((messageId: string) => {
    qc.setQueryData(['chat', 'messages', roomId], (old: CacheMsg[] | undefined) => {
      if (!old) return old;
      return old.filter((m) => m.id !== messageId);
    });
  }, [qc, roomId]);

  return { ...query, send, read, deleteForMe };
}
