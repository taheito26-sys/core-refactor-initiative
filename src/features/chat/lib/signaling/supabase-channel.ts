// ─── SupabaseSignalingChannel ─────────────────────────────────────────────────
// Wraps the existing Supabase Realtime signaling in the SignalingChannel
// interface. Zero behaviour change when Supabase is reachable — all existing
// RPC calls and CDC subscriptions are preserved verbatim.
import { supabase } from '@/integrations/supabase/client';
import {
  initiateCall as dbInitiateCall,
  answerCall,
  endCall,
  pushIceCandidate,
  getActiveCall,
} from '../../api/chat';
import type { SignalingChannel, SignalingHandlers } from './types';

export class SupabaseSignalingChannel implements SignalingChannel {
  readonly name = 'supabase';

  // ── availability probe ──────────────────────────────────────────────────
  async isAvailable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/chat_calls?select=id&limit=0`,
        {
          headers,
          signal: controller.signal,
        },
      );
      // 401 = reachable (auth required), 503 / AbortError = not reachable
      return resp.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── call lifecycle ──────────────────────────────────────────────────────
  async initiateCall(roomId: string): Promise<string> {
    return dbInitiateCall(roomId);
  }

  async publishOffer(
    callId: string,
    _roomId: string,
    sdp: string,
    initiatorId: string,
  ): Promise<void> {
    const { error } = await supabase
      .from('chat_call_participants' as never)
      .update({ sdp_offer: sdp } as never)
      .eq('call_id', callId)
      .eq('user_id', initiatorId);
    if (error) throw error;
  }

  async publishAnswer(callId: string, sdp: string): Promise<void> {
    await answerCall(callId, sdp);
  }

  async publishIceCandidate(
    callId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    await pushIceCandidate(callId, candidate);
  }

  async publishCallEnd(callId: string, reason: string): Promise<void> {
    await endCall(callId, reason);
  }

  // ── subscribe ───────────────────────────────────────────────────────────
  // Replicates the two useEffect subscriptions from useWebRTC lines 534–643,
  // extracted so the hook becomes transport-agnostic.
  subscribe(
    _callId: string | null,
    roomId: string,
    userId: string,
    handlers: SignalingHandlers,
  ): () => void {
    let cancelled = false;
    const processedIceCounts = new Map<string, number>();

    // Initial probe for an already-ringing call (mirrors lines 538–548)
    (async () => {
      try {
        const call = await getActiveCall(roomId);
        if (cancelled || !call) return;
        if (call.status === 'ringing' && call.initiated_by !== userId) {
          handlers.onIncomingCall(call.id, '', call.initiated_by);
        }
      } catch { /* non-fatal */ }
    })();

    // CDC channel 1: call status changes (mirrors lines 551–593)
    const callsCh = supabase
      .channel(`chat-calls-rt-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_calls',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (!row) return;

          if (row.status === 'ringing' && row.initiated_by !== userId) {
            handlers.onIncomingCall(row.id, '', row.initiated_by);
          }

          if (['ended', 'missed', 'declined', 'failed', 'no_answer'].includes(row.status)) {
            handlers.onCallEnd(row.end_reason ?? row.status);
          }
        },
      )
      .subscribe();

    // CDC channel 2: ICE candidates + SDP answer (mirrors lines 596–635)
    const iceCh = supabase
      .channel(`chat-ice-${userId}-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_call_participants' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (!row) return;

          if (row.user_id !== userId && row.sdp_offer) {
            handlers.onIncomingCall(row.call_id, row.sdp_offer as string, row.user_id);
          }

          if (row.user_id !== userId) {
            const remoteIce: RTCIceCandidateInit[] = Array.isArray(row.ice_candidates)
              ? row.ice_candidates
              : [];
            const already = processedIceCounts.get(row.id) ?? 0;
            for (const c of remoteIce.slice(already)) {
              handlers.onIceCandidate(c);
            }
            processedIceCounts.set(row.id, remoteIce.length);
          }

          if (row.user_id !== userId && row.sdp_answer) {
            handlers.onAnswer(row.sdp_answer as string);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(callsCh);
      supabase.removeChannel(iceCh);
    };
  }
}
