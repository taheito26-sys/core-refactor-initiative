import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoomMessages, markMessagesReadUpTo, sendMessage } from '@/features/chat/api/messages';
import { randomUUID } from '@/features/chat/utils/uuid';
import { useAuth } from '@/features/auth/auth-context';
import { setRoomUnreadCountInCache } from '@/features/chat/api/rooms';

export function useRoomMessages(roomId: string | null) {
  const qc = useQueryClient();
  const { userId } = useAuth();

  const query = useQuery({
    queryKey: ['chat', 'messages', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getRoomMessages(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Fetch failed');
      return res.data || [];
    },
  });

  const send = useMutation({
    mutationFn: async (payload: { content: string; type?: string; bodyJson?: Record<string, unknown>; expiresAt?: string | null }) => {
      if (!roomId) throw new Error('No active room');
      const clientNonce = randomUUID();
      const res = await sendMessage({
        roomId,
        clientNonce,
        body: payload.content,
        messageType: payload.type || 'text',
        bodyJson: payload.bodyJson,
        expiresAt: payload.expiresAt,
      });
      if (!res.ok) throw new Error(res.error ?? 'Send failed');
      return res.data;
    },
    onMutate: async (newMsg) => {
      await qc.cancelQueries({ queryKey: ['chat', 'messages', roomId] });
      const previous = qc.getQueryData(['chat', 'messages', roomId]);

      qc.setQueryData(['chat', 'messages', roomId], (old: any) => [
        ...(old || []),
        {
          id: `temp-${Date.now()}`,
          room_id: roomId,
          sender_id: userId,
          sender_merchant_id: userId,
          content: newMsg.content,
          body: newMsg.content,
          body_json: newMsg.bodyJson || {},
          message_type: newMsg.type || 'text',
          status: 'sending',
          created_at: new Date().toISOString(),
        },
      ]);

      return { previous };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    },
  });

  const read = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await markMessagesReadUpTo(roomId, messageId);
      return res.ok;
    },
    onMutate: async (messageId: string) => {
      if (!roomId) return;
      qc.setQueryData(['chat', 'messages', roomId], (old: any[] | undefined) => {
        if (!old) return old;
        const target = old.find((m: any) => m.id === messageId);
        if (!target) return old;
        const targetTs = new Date(target.created_at).getTime();
        return old.map((m: any) => (new Date(m.created_at).getTime() <= targetTs && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m));
      });
      setRoomUnreadCountInCache(qc, roomId, 0);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    },
  });

  return { ...query, send, read };
}
