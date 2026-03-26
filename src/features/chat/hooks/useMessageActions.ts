import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addReaction, getMessageReactions, removeReaction } from '@/features/chat/api/reactions';
import { getPinnedMessages, pinMessage, unpinMessage } from '@/features/chat/api/pins';
import { deleteMessageForEveryone, deleteMessageForMe, editMessage } from '@/features/chat/api/messages';

export function useMessageActions(roomId: string | null) {
  const qc = useQueryClient();

  const reactionsQuery = useQuery({
    queryKey: ['chat', 'reactions', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getMessageReactions(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Failed to load reactions');
      return res.data;
    },
  });

  const pinsQuery = useQuery({
    queryKey: ['chat', 'pins', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getPinnedMessages(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Failed to load pins');
      return res.data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['chat', 'reactions', roomId] });
    qc.invalidateQueries({ queryKey: ['chat', 'pins', roomId] });
    qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
  };

  const react = useMutation({
    mutationFn: async (input: { messageId: string; reaction: string; remove?: boolean }) => {
      if (!roomId) return false;
      const fn = input.remove ? removeReaction : addReaction;
      const res = await fn(roomId, input.messageId, input.reaction);
      if (!res.ok) throw new Error(res.error ?? 'Reaction update failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const pin = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await pinMessage(roomId, messageId);
      if (!res.ok) throw new Error(res.error ?? 'Pin failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const unpin = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await unpinMessage(roomId, messageId);
      if (!res.ok) throw new Error(res.error ?? 'Unpin failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const edit = useMutation({
    mutationFn: async (input: { messageId: string; body: string; bodyJson?: Record<string, unknown> }) => {
      const res = await editMessage(input.messageId, input.body, input.bodyJson);
      if (!res.ok) throw new Error(res.error ?? 'Edit failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const deleteForEveryone = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await deleteMessageForEveryone(messageId);
      if (!res.ok) throw new Error(res.error ?? 'Delete failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const deleteForMe = useMutation({
    mutationFn: async (messageId: string) => {
      if (!roomId) return false;
      const res = await deleteMessageForMe(roomId, messageId);
      if (!res.ok) throw new Error(res.error ?? 'Delete failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  return { reactionsQuery, pinsQuery, react, pin, unpin, edit, deleteForMe, deleteForEveryone };
}
