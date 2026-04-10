// ─── Signaling Configuration ──────────────────────────────────────────────────
//
// Central config for the signaling architecture.
// The frontend reads these at runtime to determine which signaling path to use.
//
// Priority:
//   1. Credentials from call-session edge function (relay URL + token)
//   2. VITE_SIGNAL_RELAY_URLS env var (static relay URLs)
//   3. Supabase Realtime CDC (always-on fallback)
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalingConfig {
  /** Whether to use the call-session edge function for credential issuance */
  useCallSession: boolean;
  /** Static relay URLs from env (used if call-session doesn't return a URL) */
  staticRelayUrls: string[];
  /** Whether Supabase CDC fallback is enabled */
  supabaseFallbackEnabled: boolean;
}

export function getSignalingConfig(): SignalingConfig {
  const staticRelayUrls = (
    (import.meta.env.VITE_SIGNAL_RELAY_URLS as string | undefined) ?? ''
  )
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  // call-session is always attempted; it gracefully degrades to supabase_fallback mode
  // when no SIGNALING_RELAY_URL is configured on the edge function
  const useCallSession = (import.meta.env.VITE_DISABLE_CALL_SESSION as string) !== 'true';

  return {
    useCallSession,
    staticRelayUrls,
    supabaseFallbackEnabled: true, // always keep Supabase CDC as safety net
  };
}

/**
 * Signaling mode returned by the call-session edge function.
 * 'relay' = dedicated WebSocket relay is available
 * 'supabase_fallback' = no relay configured, use Supabase CDC
 */
export type SignalingMode = 'relay' | 'supabase_fallback';
