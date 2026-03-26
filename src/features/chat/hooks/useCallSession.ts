import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endCall, getCallHistory, joinCall, leaveCall, startCall } from '@/features/chat/api/calls';

export function useCallSession(roomId: string | null) {
  const qc = useQueryClient();

  const history = useQuery({
    queryKey: ['chat', 'calls', roomId],
    enabled: !!roomId,
    queryFn: async () => {
      const res = await getCallHistory(roomId!);
      if (!res.ok) throw new Error(res.error ?? 'Failed call history');
      return res.data;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['chat', 'calls', roomId] });

  const start = useMutation({
    mutationFn: async () => {
      if (!roomId) return null;
      const res = await startCall(roomId);
      if (!res.ok) throw new Error(res.error ?? 'Start call failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const join = useMutation({
    mutationFn: async (callSessionId: string) => {
      const res = await joinCall(callSessionId);
      if (!res.ok) throw new Error(res.error ?? 'Join call failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const leave = useMutation({
    mutationFn: async (callSessionId: string) => {
      const res = await leaveCall(callSessionId);
      if (!res.ok) throw new Error(res.error ?? 'Leave call failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  const end = useMutation({
    mutationFn: async (callSessionId: string) => {
      const res = await endCall(callSessionId);
      if (!res.ok) throw new Error(res.error ?? 'End call failed');
      return res.data;
    },
    onSuccess: refresh,
  });

  return { history, start, join, leave, end };
}
