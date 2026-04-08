// ─── useWebRTC ────────────────────────────────────────────────────────────
// Phase 4: Resilient one-to-one voice calls (merchant_private rooms only)
// ICE / STUN / TURN / reconnect / adaptive quality / missed-call fallback
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
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'failed';

interface UseWebRTCReturn {
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
}

const RECONNECT_DELAY_MS  = 2_000;
const MAX_RECONNECT_TRIES = 5;
const RING_TIMEOUT_MS     = 45_000;

export function useWebRTC(roomId: string | null): UseWebRTCReturn {
  const { userId } = useAuth();
  const [callState,    setCallState]    = useState<CallState>('idle');
  const [localStream,  setLocalStream]  = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted,      setIsMuted]      = useState(false);
  const [incomingCall, setIncomingCall] = useState<ChatCall | null>(null);

  const pc        = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const reconnectTries = useRef(0);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActiveCallId   = useChatStore((s) => s.setActiveCallId);
  const storeActiveCallId = useChatStore((s) => s.activeCallId);

  // ── helpers ─────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    setActiveCallId(null);
    callIdRef.current = null;
    if (ringTimer.current) clearTimeout(ringTimer.current);
    reconnectTries.current = 0;
  }, [localStream, setActiveCallId]);

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
      if (s === 'connected')     setCallState('connected');
      if (s === 'disconnected' || s === 'failed') {
        if (reconnectTries.current < MAX_RECONNECT_TRIES) {
          reconnectTries.current++;
          setCallState('reconnecting');
          setTimeout(() => {
            // ICE restart
            peerConn.restartIce();
          }, RECONNECT_DELAY_MS);
        } else {
          setCallState('failed');
          if (callIdRef.current) endCall(callIdRef.current, 'failed').catch(() => {});
          cleanup();
        }
      }
    };

    return peerConn;
  }, [cleanup]);

  const getMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    setLocalStream(stream);
    return stream;
  }, []);

  // ── start call (initiator) ───────────────────────────────────────────────
  const startCall = useCallback(async () => {
    if (!roomId || !userId || callState !== 'idle') return;
    try {
      const stream = await getMedia();
      const callId = await initiateCall(roomId);
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('calling');

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      const offer = await peerConn.createOffer({ offerToReceiveAudio: true });
      await peerConn.setLocalDescription(offer);

      // Store SDP offer for recipient to fetch
      await supabase
        .from('chat_call_participants')
        .update({ sdp_offer: offer.sdp } as never)
        .eq('call_id', callId)
        .eq('user_id', userId);

      // Ring timeout → fallback to missed
      const currentState = callState;
      ringTimer.current = setTimeout(async () => {
        if (currentState === 'calling') {
          setCallState('ended');
          await endCall(callId, 'no_answer').catch(() => {});
          cleanup();
        }
      }, RING_TIMEOUT_MS);

    } catch (err) {
      console.error('[WebRTC] startCall failed', err);
      setCallState('failed');
      cleanup();
    }
  }, [roomId, userId, callState, getMedia, buildPC, setActiveCallId, cleanup]);

  // ── answer incoming call ─────────────────────────────────────────────────
  const answerIncoming = useCallback(async () => {
    if (!incomingCall || !userId) return;
    try {
      const stream = await getMedia();
      const callId = incomingCall.id;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('connected');

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

    } catch (err) {
      console.error('[WebRTC] answerIncoming failed', err);
      setCallState('failed');
      cleanup();
    }
  }, [incomingCall, userId, getMedia, buildPC, setActiveCallId, cleanup]);

  // ── decline ───────────────────────────────────────────────────────────────
  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    await endCall(incomingCall.id, 'declined').catch(() => {});
    setIncomingCall(null);
  }, [incomingCall]);

  // ── hang up ───────────────────────────────────────────────────────────────
  const hangUp = useCallback(async () => {
    if (callIdRef.current) {
      await endCall(callIdRef.current, 'ended').catch(() => {});
    }
    setCallState('ended');
    cleanup();
  }, [cleanup]);

  // ── mute ─────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const enabled = !isMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    setIsMuted(!enabled);
  }, [localStream, isMuted]);

  // ── Listen for incoming calls and ICE candidates ──────────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    // Poll active call (ringing) every 3s — realtime handles the rest
    let pollTimer: ReturnType<typeof setTimeout>;
    const pollIncoming = async () => {
      const call = await getActiveCall(roomId).catch(() => null);
      if (call && call.status === 'ringing' && call.initiated_by !== userId) {
        setIncomingCall(call);
        useChatStore.getState().setIncomingCall(call.id, roomId);
      } else if (!call) {
        setIncomingCall(null);
      }
      pollTimer = setTimeout(pollIncoming, 3_000);
    };
    pollIncoming();

    // ICE candidates channel
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
          if (!pc.current || !row?.ice_candidates?.length) return;
          for (const c of row.ice_candidates) {
            try {
              await pc.current.addIceCandidate(new RTCIceCandidate(c));
            } catch { /* stale candidate, ignore */ }
          }
          // SDP answer arrived (if we're initiator)
          if (row.sdp_answer && pc.current.signalingState === 'have-local-offer') {
            try {
              await pc.current.setRemoteDescription({ type: 'answer', sdp: row.sdp_answer });
              setCallState('connected');
            } catch { /* already set */ }
          }
        },
      )
      .subscribe();

    return () => {
      clearTimeout(pollTimer);
      supabase.removeChannel(iceCh);
    };
  }, [roomId, userId]);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { cleanup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    callState,
    localStream,
    remoteStream,
    activeCallId: storeActiveCallId,
    incomingCall,
    startCall,
    answerIncoming,
    declineIncoming,
    hangUp,
    toggleMute,
    isMuted,
  };
}
