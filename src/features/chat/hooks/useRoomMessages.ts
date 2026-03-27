import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoomMessages, markRead, sendMessage } from '@/features/chat/api/messages';
import { randomUUID } from '@/features/chat/utils/uuid';
import { useAuth } from '@/features/auth/auth-context';

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
        expiresAt: payload.expiresAt
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
      const res = await markRead(roomId, messageId);
      return res.ok;
    },
  });

  return { ...query, send, read };
}
