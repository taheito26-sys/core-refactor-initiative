import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTyping, setTyping } from '@/features/chat/api/presence';

export function useTypingPresence(roomId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['chat', 'typing', roomId],
    enabled: !!roomId,
    refetchInterval: 4000,
    queryFn: async () => {
      const res = await getTyping(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Typing failed');
      return res.data;
    },
  });

  const updateTyping = useMutation({
    mutationFn: async (isTyping: boolean) => {
      if (!roomId) return false;
      const res = await setTyping(roomId, isTyping);
      if (!res.ok) throw new Error(res.error ?? 'Typing update failed');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'typing', roomId] }),
  });

  return { ...query, updateTyping };
}
