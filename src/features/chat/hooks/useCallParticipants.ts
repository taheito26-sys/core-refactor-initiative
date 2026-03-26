import { useMemo } from 'react';
import { useCallSession } from '@/features/chat/hooks/useCallSession';

export function useCallParticipants(roomId: string | null) {
  const { history } = useCallSession(roomId);

  const activeCall = useMemo(() => {
    const calls = history.data ?? [];
    return calls.find((c: any) => c.status === 'active' || c.status === 'ringing') ?? null;
  }, [history.data]);

  const participants = useMemo(() => {
    const p = activeCall?.participants;
    return Array.isArray(p) ? p : [];
  }, [activeCall]);

  return { activeCall, participants, history };
}
