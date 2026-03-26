import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyRoomPolicy, getPolicyAudit, getRoomPolicy } from '@/features/chat/api/policies';

export function useRoomPolicy(roomId: string | null) {
  const qc = useQueryClient();

  const policy = useQuery({
    queryKey: ['chat', 'policy', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getRoomPolicy(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Policy fetch failed');
      return res.data;
    },
  });

  const audit = useQuery({
    queryKey: ['chat', 'policy-audit', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getPolicyAudit(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Policy audit fetch failed');
      return res.data;
    },
  });

  const update = useMutation({
    mutationFn: async (input: { security: Record<string, unknown>; retention: Record<string, unknown> }) => {
      if (!roomId) return false;
      const res = await applyRoomPolicy(roomId, input.security, input.retention);
      if (!res.ok) throw new Error(res.error ?? 'Policy update failed');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'policy', roomId] });
      qc.invalidateQueries({ queryKey: ['chat', 'policy-audit', roomId] });
    },
  });

  return { policy, audit, update };
}
