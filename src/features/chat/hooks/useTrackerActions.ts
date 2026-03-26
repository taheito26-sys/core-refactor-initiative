import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createActionItemFromMessage,
  createOrderDraftFromMessage,
  getTrackerLinksForRoom,
} from '@/features/chat/api/tracker-actions';

export function useTrackerActions(roomId: string | null, relationshipId: string | null) {
  const qc = useQueryClient();

  const links = useQuery({
    queryKey: ['chat', 'tracker-links', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getTrackerLinksForRoom(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Failed tracker links');
      return res.data;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['chat', 'tracker-links', roomId] });

  const createOrderDraft = useMutation({
    mutationFn: async (input: { messageId: string; title: string; amount?: number; currency?: string }) => {
      if (!roomId) throw new Error('No room selected');
      const res = await createOrderDraftFromMessage({
        roomId,
        relationshipId,
        messageId: input.messageId,
        title: input.title,
        amount: input.amount,
        currency: input.currency,
      });
      if (!res.ok) throw new Error(res.error ?? 'Create order failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const createTask = useMutation({
    mutationFn: async (input: { messageId: string; title: string; payload?: Record<string, unknown> }) => {
      if (!roomId) throw new Error('No room selected');
      const res = await createActionItemFromMessage({
        roomId,
        messageId: input.messageId,
        kind: 'task',
        title: input.title,
        payload: input.payload,
      });
      if (!res.ok) throw new Error(res.error ?? 'Create task failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const createReminder = useMutation({
    mutationFn: async (input: { messageId: string; title: string; payload?: Record<string, unknown> }) => {
      if (!roomId) throw new Error('No room selected');
      const res = await createActionItemFromMessage({ roomId, messageId: input.messageId, kind: 'reminder', title: input.title, payload: input.payload });
      if (!res.ok) throw new Error(res.error ?? 'Create reminder failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const createCash = useMutation({
    mutationFn: async (input: { messageId: string; title: string; payload?: Record<string, unknown> }) => {
      if (!roomId) throw new Error('No room selected');
      const res = await createActionItemFromMessage({ roomId, messageId: input.messageId, kind: 'cash', title: input.title, payload: input.payload });
      if (!res.ok) throw new Error(res.error ?? 'Create cash action failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const createStock = useMutation({
    mutationFn: async (input: { messageId: string; title: string; payload?: Record<string, unknown> }) => {
      if (!roomId) throw new Error('No room selected');
      const res = await createActionItemFromMessage({ roomId, messageId: input.messageId, kind: 'stock', title: input.title, payload: input.payload });
      if (!res.ok) throw new Error(res.error ?? 'Create stock action failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  return { links, createOrderDraft, createTask, createReminder, createCash, createStock };
}
