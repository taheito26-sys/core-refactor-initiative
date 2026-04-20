import { supabase } from '@/integrations/supabase/client';

const HEARTBEAT_MS = 5 * 60 * 1000;

function getSessionId(userId: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const SESSION_STORAGE_KEY = `app_usage_session_id:${userId}`;
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return null;
  }
}

function getPlatformLabel(): string {
  if (typeof navigator === 'undefined') return 'web';

  // Keep this lightweight and privacy-preserving.
  const platform = navigator.userAgentData?.platform || navigator.platform || 'web';
  return String(platform).slice(0, 40);
}

async function pingAppUsage(userId: string, sessionId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const { error } = await supabase.rpc('record_app_usage_session' as never, {
    p_user_id: userId,
    p_session_id: sessionId,
    p_platform: getPlatformLabel(),
    p_app_version: import.meta.env.VITE_APP_VERSION ?? null,
    p_last_seen_at: timestamp,
  } as never);

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('record_app_usage_session') || message.includes('schema cache') || message.includes('404')) {
      return;
    }
    console.warn('[app-activity] failed to record usage session:', error.message);
  }
}

/**
 * Start an app usage heartbeat for the signed-in user.
 * One row is tracked per browser session; repeated pings only refresh last_seen_at.
 */
export function startAppActivityTracking(userId: string): () => void {
  if (typeof window === 'undefined') return () => {};

  const sessionId = getSessionId(userId);
  if (!sessionId) return () => {};

  let stopped = false;

  const record = () => {
    if (stopped) return;
    void pingAppUsage(userId, sessionId);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      record();
    }
  };

  record();
  window.addEventListener('focus', record);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const interval = window.setInterval(record, HEARTBEAT_MS);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener('focus', record);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
