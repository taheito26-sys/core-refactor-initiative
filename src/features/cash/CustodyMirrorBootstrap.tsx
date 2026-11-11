import { useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { applyCustodyMirrorToCloud } from './custody-mirror-cloud';
import { useCustodyMirrorStatus } from './useCustodyMirrorStatus';

/**
 * Keeps a custody account that mirrors its holder's balance up to date on every screen, not
 * only while Cash Management is open. Silent: a failed write just retries on the next poll.
 */
export function CustodyMirrorBootstrap() {
  const { userId } = useAuth();
  const { data: statuses } = useCustodyMirrorStatus(!!userId);

  useEffect(() => {
    if (!userId || !statuses?.some((s) => s.role === 'mirror')) return;
    void applyCustodyMirrorToCloud(statuses).catch(() => {});
  }, [userId, statuses]);

  return null;
}
