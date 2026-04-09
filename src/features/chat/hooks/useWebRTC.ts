// ─── useWebRTC ────────────────────────────────────────────────────────────
// Production-hardened voice/video calls for merchant_private rooms.
// Realtime signaling (no polling), explicit state machine, video toggle,
// proper cleanup, ICE restart, call summary messages, mobile-safe.
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
  | 'calling'      // outbound ring
  | 'ringing'      // inbound ring
  | 'connecting'   // SDP exchanged, waiting ICE
  | 'connected'    // media flowing
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
  startCall:        (video?: boolean) => Promise<void>;
  answerIncoming:   () => Promise<void>;
  declineIncoming:  () => Promise<void>;
  hangUp:           () => Promise<void>;
  toggleMute:       () => void;
  toggleVideo:      () => void;
  isMuted:          boolean;
  isVideoEnabled:   boolean;
  isVideoCall:      boolean;
  callDuration:     number;
  endReason:        string | null;
}

const RECONNECT_DELAY_MS  = 2_000;
const MAX_RECONNECT_TRIES = 5;
const RING_TIMEOUT_MS     = 45_000;
const END_STATE_LINGER_MS = 3_000;

export function useWebRTC(roomId: string | null): UseWebRTCReturn {
  const { userId } = useAuth();
  const [callState,      setCallState]      = useState<CallState>('idle');
  const [localStream,    setLocalStream]    = useState<MediaStream | null>(null);
  const [remoteStream,   setRemoteStream]   = useState<MediaStream | null>(null);
  const [isMuted,        setIsMuted]        = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isVideoCall,    setIsVideoCall]    = useState(false);
  const [incomingCall,   setIncomingCall]   = useState<ChatCall | null>(null);
  const [callDuration,   setCallDuration]   = useState(0);
  const [endReason,      setEndReason]      = useState<string | null>(null);

  const pc              = useRef<RTCPeerConnection | null>(null);
  const callIdRef       = useRef<string | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const roomIdRef       = useRef<string | null>(roomId);
  const reconnectTries  = useRef(0);
  const ringTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lingerTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef  = useRef<number | null>(null);
  const cleaningUp      = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

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

  // NOTE: Call summary messages are inserted by the DB-side chat_end_call RPC.
  // No client-side insertion needed — avoids duplicate messages.

  // ── full cleanup ───────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleaningUp.current) return;
    cleaningUp.current = true;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());

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
    localStreamRef.current = null;
    setIsMuted(false);
    setIsVideoEnabled(false);
    setIsVideoCall(false);
    connectedAtRef.current = null;
    setCallDuration(0);

    if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    reconnectTries.current = 0;

    cleaningUp.current = false;
  }, [setActiveCallId]);

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
            try { peerConn.restartIce(); } catch { /* closed */ }
          }, RECONNECT_DELAY_MS);
        } else {
          const dur = connectedAtRef.current ? Math.floor((Date.now() - connectedAtRef.current) / 1000) : 0;
          const cid = callIdRef.current;
          if (cid) endCall(cid, 'failed').catch(() => {});
          cleanup();
          transitionToEnd('failed', 'connection_lost');
        }
      }
      if (s === 'failed') {
        const cid = callIdRef.current;
        if (cid) endCall(cid, 'failed').catch(() => {});
        cleanup();
        transitionToEnd('failed', 'ice_failed');
      }
    };

    return peerConn;
  }, [cleanup, startDurationTimer, transitionToEnd, sendCallSummary]);

  // ── get media (audio, optionally video) ───────────────────────────────
  const getMedia = useCallback(async (video = false) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    setLocalStream(stream);
    setIsVideoEnabled(video);
    setIsVideoCall(video);
    return stream;
  }, []);

  // ── START CALL ────────────────────────────────────────────────────────
  const startCallFn = useCallback(async (video = false) => {
    if (!roomId || !userId || callState !== 'idle') return;
    try {
      const stream = await getMedia(video);
      const callId = await initiateCall(roomId);
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('calling');
      setEndReason(null);

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      const offer = await peerConn.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: video,
      });
      await peerConn.setLocalDescription(offer);

      await supabase
        .from('chat_call_participants')
        .update({ sdp_offer: offer.sdp } as never)
        .eq('call_id', callId)
        .eq('user_id', userId);

      // Ring timeout → missed
      ringTimer.current = setTimeout(async () => {
        if (callIdRef.current === callId) {
          await endCall(callId, 'no_answer').catch(() => {});
          cleanup();
          sendCallSummary('missed', 0, callId);
          transitionToEnd('missed', 'no_answer');
        }
      }, RING_TIMEOUT_MS);

    } catch (err) {
      console.error('[WebRTC] startCall failed', err);
      cleanup();
      transitionToEnd('failed', 'start_error');
    }
  }, [roomId, userId, callState, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd, sendCallSummary]);

  // ── ANSWER INCOMING ───────────────────────────────────────────────────
  const answerIncoming = useCallback(async () => {
    if (!incomingCall || !userId) return;
    try {
      const stream = await getMedia(false); // answer as audio; can toggle video later
      const callId = incomingCall.id;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('connecting');
      setEndReason(null);

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

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
    const dur = connectedAtRef.current ? Math.floor((Date.now() - connectedAtRef.current) / 1000) : 0;
    const cid = callIdRef.current;
    if (cid) {
      await endCall(cid, 'ended').catch(() => {});
    }
    cleanup();
    if (dur > 0 && cid) sendCallSummary('ended', dur, cid);
    transitionToEnd('ended', 'ended');
  }, [cleanup, transitionToEnd, sendCallSummary]);

  // ── MUTE ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setIsMuted(newMuted);
  }, [localStream, isMuted]);

  // ── VIDEO TOGGLE ──────────────────────────────────────────────────────
  const toggleVideo = useCallback(async () => {
    if (!localStream || !pc.current) return;

    const videoTracks = localStream.getVideoTracks();

    if (videoTracks.length > 0) {
      // Disable video
      videoTracks.forEach((t) => { t.stop(); localStream.removeTrack(t); });
      const sender = pc.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(null);
      setIsVideoEnabled(false);
    } else {
      // Enable video
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);

        const sender = pc.current.getSenders().find((s) => s.track === null || s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        } else {
          pc.current.addTrack(videoTrack, localStream);
        }
        setIsVideoEnabled(true);
        setIsVideoCall(true);
      } catch (err) {
        console.warn('[WebRTC] toggleVideo: camera access failed', err);
      }
    }
  }, [localStream]);

  // ── REALTIME: incoming calls (replaces polling) ───────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    // Initial check for any active ringing call
    let cancelled = false;
    (async () => {
      try {
        const call = await getActiveCall(roomId);
        if (cancelled) return;
        if (call && call.status === 'ringing' && call.initiated_by !== userId && !callIdRef.current) {
          setIncomingCall(call);
          setCallState('ringing');
          useChatStore.getState().setIncomingCall(call.id, roomId);
        }
      } catch { /* ignore */ }
    })();

    // Realtime subscription on chat_calls for this room
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

          // New or updated call
          if (row.status === 'ringing' && row.initiated_by !== userId && !callIdRef.current) {
            const incoming: ChatCall = row as ChatCall;
            setIncomingCall(incoming);
            setCallState('ringing');
            useChatStore.getState().setIncomingCall(incoming.id, roomId);
          }

          // Call ended/cancelled by the other party
          if (['ended', 'missed', 'declined', 'failed', 'no_answer'].includes(row.status)) {
            if (row.id === callIdRef.current) {
              // Active call was ended by the other party
              const dur = connectedAtRef.current ? Math.floor((Date.now() - connectedAtRef.current) / 1000) : 0;
              cleanup();
              if (row.end_reason === 'declined') {
                transitionToEnd('declined', 'remote_declined');
              } else {
                if (dur > 0) sendCallSummary('ended', dur, row.id);
                transitionToEnd('ended', 'remote_ended');
              }
            }
            // Incoming call was cancelled
            if (incomingCall?.id === row.id) {
              setIncomingCall(null);
              useChatStore.getState().setIncomingCall(null, null);
              transitionToEnd('missed', 'caller_cancelled');
            }
          }
        },
      )
      .subscribe();

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

          if (row.ice_candidates?.length) {
            for (const c of row.ice_candidates) {
              try {
                await pc.current.addIceCandidate(new RTCIceCandidate(c));
              } catch { /* stale */ }
            }
          }

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
      supabase.removeChannel(callsCh);
      supabase.removeChannel(iceCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  // ── beforeunload: cleanup on tab close ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callIdRef.current) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/chat_end_call`;
        const body = JSON.stringify({ _call_id: callIdRef.current, _end_reason: 'tab_closed' });
        try {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } catch { /* best effort */ }
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pc.current?.close();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

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
    toggleVideo,
    isMuted,
    isVideoEnabled,
    isVideoCall,
    callDuration,
    endReason,
  };
}
