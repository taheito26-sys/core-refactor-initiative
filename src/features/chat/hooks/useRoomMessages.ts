import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoomMessages, markRead, scheduleMessage, sendMessage } from '@/features/chat/api/messages';
import { randomUUID } from '@/features/chat/utils/uuid';

export function useRoomMessages(roomId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['chat', 'messages', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getRoomMessages(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Failed to load messages');
      return res.data;
    },
  });

  const send = useMutation({
    mutationFn: async (payload: { body: string; messageType?: string; bodyJson?: Record<string, unknown>; replyToMessageId?: string | null }) => {
      if (!roomId) throw new Error('No active room');
      const clientNonce = randomUUID();
      const res = await sendMessage({ roomId, clientNonce, ...payload });
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
          body: newMsg.body,
          body_json: newMsg.bodyJson || {},
          message_type: newMsg.messageType || 'text',
          status: 'sending',
          created_at: new Date().toISOString(),
          reply_to_message_id: newMsg.replyToMessageId,
        },
      ]);

      return { previous };
    },
    onError: (err, newMsg, context: any) => {
      qc.setQueryData(['chat', 'messages', roomId], context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    },
  });

  const read = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await markRead(roomId, messageId);
      if (!res.ok) throw new Error(res.error ?? 'Read failed');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    },
  });

  const schedule = useMutation({
    mutationFn: async (payload: { body: string; runAt: string; bodyJson?: Record<string, unknown> }) => {
      if (!roomId) return false;
      const res = await scheduleMessage({
        roomId,
        body: payload.body,
        runAt: payload.runAt,
        bodyJson: payload.bodyJson,
        clientNonce: randomUUID(),
      });
      if (!res.ok) throw new Error(res.error ?? 'Schedule failed');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    },
  });

  return { ...query, send, read, schedule };
}
