// ─── useWebRTC ────────────────────────────────────────────────────────────
// Production-hardened one-to-one voice calls for merchant_private rooms.
// Explicit state machine, proper cleanup, ICE restart, mobile-safe.
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  initiateCall, answerCall, endCall, pushIceCandidate,
  getActiveCall, DEFAULT_ICE_CONFIG,
} from '../api/chat';
import { useChatStore } from '@/lib/chat-store';
import type { ChatCall } from '../types';

export type CallState =
  | 'idle'
  | 'calling'     // outbound ring
  | 'ringing'     // inbound ring
  | 'connecting'  // SDP exchanged, waiting ICE
  | 'connected'   // media flowing
  | 'reconnecting'
  | 'ended'
  | 'failed'
  | 'missed'
  | 'declined';

export interface UseWebRTCReturn {
  callState:        CallState;
  localStream:      MediaStream | null;
  remoteStream:     MediaStream | null;
  activeCallId:     string | null;
  incomingCall:     ChatCall | null;
  startCall:        () => Promise<void>;
  answerIncoming:   () => Promise<void>;
  declineIncoming:  () => Promise<void>;
  hangUp:           () => Promise<void>;
  toggleMute:       () => void;
  isMuted:          boolean;
  callDuration:     number;          // seconds since connected
  endReason:        string | null;
}

const RECONNECT_DELAY_MS  = 2_000;
const MAX_RECONNECT_TRIES = 5;
const RING_TIMEOUT_MS     = 45_000;
const END_STATE_LINGER_MS = 3_000; // show ended/failed/missed briefly

export function useWebRTC(roomId: string | null): UseWebRTCReturn {
  const { userId } = useAuth();
  const [callState,    setCallState]    = useState<CallState>('idle');
  const [localStream,  setLocalStream]  = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted,      setIsMuted]      = useState(false);
  const [incomingCall, setIncomingCall]  = useState<ChatCall | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [endReason,    setEndReason]    = useState<string | null>(null);

  const pc              = useRef<RTCPeerConnection | null>(null);
  const callIdRef       = useRef<string | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const reconnectTries  = useRef(0);
  const ringTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lingerTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef  = useRef<number | null>(null);
  const cleaningUp      = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  const setActiveCallId   = useChatStore((s) => s.setActiveCallId);
  const storeActiveCallId = useChatStore((s) => s.activeCallId);

  // ── transition to terminal state, then auto-reset ──────────────────────
  const transitionToEnd = useCallback((state: 'ended' | 'failed' | 'missed' | 'declined', reason?: string) => {
    setCallState(state);
    setEndReason(reason ?? state);
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = setTimeout(() => {
      setCallState('idle');
      setEndReason(null);
    }, END_STATE_LINGER_MS);
  }, []);

  // ── full cleanup ───────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleaningUp.current) return;
    cleaningUp.current = true;

    // Stop all local media tracks
    localStream?.getTracks().forEach((t) => t.stop());

    // Close peer connection
    if (pc.current) {
      pc.current.onicecandidate = null;
      pc.current.ontrack = null;
      pc.current.onconnectionstatechange = null;
      pc.current.oniceconnectionstatechange = null;
      pc.current.close();
      pc.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setActiveCallId(null);
    callIdRef.current = null;
    setIsMuted(false);
    connectedAtRef.current = null;
    setCallDuration(0);

    if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    reconnectTries.current = 0;

    cleaningUp.current = false;
  }, [localStream, setActiveCallId]);

  // ── start duration timer ──────────────────────────────────────────────
  const startDurationTimer = useCallback(() => {
    connectedAtRef.current = Date.now();
    if (durationTimer.current) clearInterval(durationTimer.current);
    durationTimer.current = setInterval(() => {
      if (connectedAtRef.current) {
        setCallDuration(Math.floor((Date.now() - connectedAtRef.current) / 1000));
      }
    }, 1000);
  }, []);

  // ── build peer connection ─────────────────────────────────────────────
  const buildPC = useCallback(() => {
    const peerConn = new RTCPeerConnection(DEFAULT_ICE_CONFIG);

    peerConn.onicecandidate = (e) => {
      if (e.candidate && callIdRef.current) {
        pushIceCandidate(callIdRef.current, e.candidate.toJSON()).catch(() => {});
      }
    };

    peerConn.ontrack = (e) => {
      setRemoteStream(e.streams[0] ?? null);
    };

    peerConn.onconnectionstatechange = () => {
      const s = peerConn.connectionState;
      if (s === 'connected') {
        setCallState('connected');
        reconnectTries.current = 0;
        if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
        startDurationTimer();
      }
      if (s === 'disconnected') {
        if (reconnectTries.current < MAX_RECONNECT_TRIES) {
          reconnectTries.current++;
          setCallState('reconnecting');
          setTimeout(() => {
            try { peerConn.restartIce(); } catch { /* already closed */ }
          }, RECONNECT_DELAY_MS);
        } else {
          if (callIdRef.current) endCall(callIdRef.current, 'failed').catch(() => {});
          cleanup();
          transitionToEnd('failed', 'connection_lost');
        }
      }
      if (s === 'failed') {
        if (callIdRef.current) endCall(callIdRef.current, 'failed').catch(() => {});
        cleanup();
        transitionToEnd('failed', 'ice_failed');
      }
    };

    return peerConn;
  }, [cleanup, startDurationTimer, transitionToEnd]);

  // ── get microphone ────────────────────────────────────────────────────
  const getMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    setLocalStream(stream);
    return stream;
  }, []);

  // ── START CALL (initiator) ────────────────────────────────────────────
  const startCallFn = useCallback(async () => {
    if (!roomId || !userId || callState !== 'idle') return;
    try {
      const stream = await getMedia();
      const callId = await initiateCall(roomId);
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('calling');
      setEndReason(null);

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      const offer = await peerConn.createOffer({ offerToReceiveAudio: true });
      await peerConn.setLocalDescription(offer);

      // Store SDP offer for recipient
      await supabase
        .from('chat_call_participants')
        .update({ sdp_offer: offer.sdp } as never)
        .eq('call_id', callId)
        .eq('user_id', userId);

      // Ring timeout → missed
      ringTimer.current = setTimeout(async () => {
        const currentState = callIdRef.current;
        if (currentState === callId) {
          await endCall(callId, 'no_answer').catch(() => {});
          cleanup();
          transitionToEnd('missed', 'no_answer');
        }
      }, RING_TIMEOUT_MS);

    } catch (err) {
      console.error('[WebRTC] startCall failed', err);
      cleanup();
      transitionToEnd('failed', 'start_error');
    }
  }, [roomId, userId, callState, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd]);

  // ── ANSWER INCOMING ───────────────────────────────────────────────────
  const answerIncoming = useCallback(async () => {
    if (!incomingCall || !userId) return;
    try {
      const stream = await getMedia();
      const callId = incomingCall.id;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('connecting');
      setEndReason(null);

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      // Fetch initiator's SDP offer
      const { data } = await supabase
        .from('chat_call_participants' as never)
        .select('sdp_offer')
        .eq('call_id', callId)
        .eq('user_id', incomingCall.initiated_by)
        .single();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const offerSdp = (data as any)?.sdp_offer;
      if (!offerSdp) throw new Error('No SDP offer from initiator');

      await peerConn.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);

      await answerCall(callId, answer.sdp!);
      setIncomingCall(null);
      useChatStore.getState().setIncomingCall(null, null);

    } catch (err) {
      console.error('[WebRTC] answerIncoming failed', err);
      cleanup();
      transitionToEnd('failed', 'answer_error');
    }
  }, [incomingCall, userId, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd]);

  // ── DECLINE ───────────────────────────────────────────────────────────
  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    await endCall(incomingCall.id, 'declined').catch(() => {});
    setIncomingCall(null);
    useChatStore.getState().setIncomingCall(null, null);
    transitionToEnd('declined', 'declined');
  }, [incomingCall, transitionToEnd]);

  // ── HANG UP ───────────────────────────────────────────────────────────
  const hangUp = useCallback(async () => {
    if (callIdRef.current) {
      await endCall(callIdRef.current, 'ended').catch(() => {});
    }
    cleanup();
    transitionToEnd('ended', 'ended');
  }, [cleanup, transitionToEnd]);

  // ── MUTE ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setIsMuted(newMuted);
  }, [localStream, isMuted]);

  // ── Listen for incoming calls + ICE/SDP exchange ──────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    let pollTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const pollIncoming = async () => {
      if (cancelled) return;
      try {
        const call = await getActiveCall(roomId);
        if (cancelled) return;

        if (call && call.status === 'ringing' && call.initiated_by !== userId && !callIdRef.current) {
          setIncomingCall(call);
          setCallState('ringing');
          useChatStore.getState().setIncomingCall(call.id, roomId);
        } else if (!call && incomingCall) {
          // Call was cancelled/ended by initiator
          setIncomingCall(null);
          useChatStore.getState().setIncomingCall(null, null);
          if (callState === 'ringing') {
            transitionToEnd('missed', 'caller_cancelled');
          }
        }
      } catch { /* network hiccup */ }
      if (!cancelled) pollTimer = setTimeout(pollIncoming, 3_000);
    };
    pollIncoming();

    // ICE + SDP answer channel
    const iceCh = supabase
      .channel(`chat-ice-${userId}-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_call_participants',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (!pc.current || !row) return;

          // Process ICE candidates
          if (row.ice_candidates?.length) {
            for (const c of row.ice_candidates) {
              try {
                await pc.current.addIceCandidate(new RTCIceCandidate(c));
              } catch { /* stale candidate */ }
            }
          }

          // SDP answer arrived (if we're initiator)
          if (row.sdp_answer && pc.current.signalingState === 'have-local-offer') {
            try {
              await pc.current.setRemoteDescription({ type: 'answer', sdp: row.sdp_answer });
              setCallState('connecting');
            } catch { /* already set */ }
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      supabase.removeChannel(iceCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  // ── beforeunload: cleanup on tab close ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callIdRef.current) {
        // Use sendBeacon for reliability
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/chat_end_call`;
        const body = JSON.stringify({ _call_id: callIdRef.current, _end_reason: 'tab_closed' });
        try {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } catch { /* best effort */ }
      }
      localStream?.getTracks().forEach((t) => t.stop());
      pc.current?.close();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [localStream]);

  // ── cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (callIdRef.current) {
        endCall(callIdRef.current, 'navigated_away').catch(() => {});
      }
      cleanup();
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── cleanup on room change ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (callIdRef.current) {
        endCall(callIdRef.current, 'room_changed').catch(() => {});
        cleanup();
        setCallState('idle');
        setEndReason(null);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return {
    callState,
    localStream,
    remoteStream,
    activeCallId: storeActiveCallId,
    incomingCall,
    startCall: startCallFn,
    answerIncoming,
    declineIncoming,
    hangUp,
    toggleMute,
    isMuted,
    callDuration,
    endReason,
  };
}
