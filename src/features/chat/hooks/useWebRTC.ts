// ─── useWebRTC ────────────────────────────────────────────────────────────
// Production-hardened voice/video calls for merchant_private rooms.
// Realtime signaling (no polling), explicit state machine, video toggle,
// screen sharing, call quality stats, group calls (mesh), proper cleanup.
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  DEFAULT_ICE_CONFIG, getCallParticipants,
} from '../api/chat';
import { useChatStore } from '@/lib/chat-store';
import { MultiSignalingChannel } from '../lib/signaling/multi-channel';
import type { SignalingHandlers } from '../lib/signaling/types';
import type { ChatCall } from '../types';
import { isNativeApp } from '@/platform/runtime';

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

export interface CallQualityStats {
  bitrate: number;        // kbps
  packetLoss: number;     // percentage 0-100
  jitter: number;         // ms
  roundTripTime: number;  // ms
  level: 'excellent' | 'good' | 'poor';
}

export interface UseWebRTCReturn {
  callState:         CallState;
  localStream:       MediaStream | null;
  remoteStream:      MediaStream | null;
  activeCallId:      string | null;
  incomingCall:      ChatCall | null;
  startCall:         (video?: boolean) => Promise<void>;
  answerIncoming:    () => Promise<void>;
  declineIncoming:   () => Promise<void>;
  hangUp:            () => Promise<void>;
  toggleMute:        () => void;
  toggleVideo:       () => void;
  toggleScreenShare: () => Promise<void>;
  isMuted:           boolean;
  isVideoEnabled:    boolean;
  isVideoCall:       boolean;
  isScreenSharing:   boolean;
  callDuration:      number;
  endReason:         string | null;
  qualityStats:      CallQualityStats | null;
  // Group calls
  remoteStreams:      Map<string, MediaStream>;
  participantCount:  number;
}

const RECONNECT_DELAY_MS  = 2_000;
const MAX_RECONNECT_TRIES = 5;
const RING_TIMEOUT_MS     = 45_000;
const END_STATE_LINGER_MS = 3_000;
const QUALITY_POLL_MS     = 3_000;

function computeQualityLevel(stats: Omit<CallQualityStats, 'level'>): CallQualityStats['level'] {
  if (stats.packetLoss > 10 || stats.roundTripTime > 400 || stats.jitter > 100) return 'poor';
  if (stats.packetLoss > 3 || stats.roundTripTime > 200 || stats.jitter > 50) return 'good';
  return 'excellent';
}

export function useWebRTC(roomId: string | null): UseWebRTCReturn {
  const { userId } = useAuth();
  const [callState,       setCallState]       = useState<CallState>('idle');
  const [localStream,     setLocalStream]     = useState<MediaStream | null>(null);
  const [remoteStream,    setRemoteStream]    = useState<MediaStream | null>(null);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isVideoEnabled,  setIsVideoEnabled]  = useState(false);
  const [isVideoCall,     setIsVideoCall]     = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [incomingCall,    setIncomingCall]     = useState<ChatCall | null>(null);
  const [callDuration,    setCallDuration]    = useState(0);
  const [endReason,       setEndReason]       = useState<string | null>(null);
  const [qualityStats,    setQualityStats]    = useState<CallQualityStats | null>(null);
  const [remoteStreams,    setRemoteStreams]   = useState<Map<string, MediaStream>>(new Map());
  const [participantCount, setParticipantCount] = useState(0);

  const pc              = useRef<RTCPeerConnection | null>(null);
  const callIdRef       = useRef<string | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const roomIdRef       = useRef<string | null>(roomId);
  const reconnectTries  = useRef(0);
  const ringTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lingerTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedAtRef  = useRef<number | null>(null);
  const cleaningUp      = useRef(false);
  const screenTrackRef  = useRef<MediaStreamTrack | null>(null);
  const prevBytesRef    = useRef<{ received: number; ts: number } | null>(null);
  const processedRemoteIceCounts = useRef<Map<string, number>>(new Map());
  // Group calls: map of peerId → RTCPeerConnection
  const groupPCs        = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Multi-channel signaling (Supabase + WS relay; lazy init once per mount)
  const signalingRef    = useRef<MultiSignalingChannel | null>(null);
  if (!signalingRef.current) {
    signalingRef.current = MultiSignalingChannel.create();
  }
  const signaling = signalingRef.current;

  // Incoming call ref — kept in sync with state so async handlers see current value
  const incomingCallRef = useRef<ChatCall | null>(null);

  // Keep refs in sync with state
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

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

  // ── persist quality stats to DB ───────────────────────────────────────
  const persistQualityStats = useCallback(async (stats: CallQualityStats) => {
    const cid = callIdRef.current;
    if (!cid) return;
    try {
      await supabase
        .from('chat_calls')
        .update({ quality_stats: stats } as never)
        .eq('id', cid);
    } catch { /* non-fatal */ }
  }, []);

  // ── poll quality stats from RTCPeerConnection ─────────────────────────
  const startQualityPolling = useCallback(() => {
    if (qualityTimer.current) clearInterval(qualityTimer.current);
    prevBytesRef.current = null;

    qualityTimer.current = setInterval(async () => {
      if (!pc.current) return;
      try {
        const stats = await pc.current.getStats();
        let totalBytesReceived = 0;
        let packetLoss = 0;
        let jitter = 0;
        let rtt = 0;
        let hasInbound = false;
        let hasCandidate = false;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            totalBytesReceived = report.bytesReceived ?? 0;
            packetLoss = report.packetsLost ?? 0;
            const received = report.packetsReceived ?? 1;
            packetLoss = received > 0 ? (packetLoss / (packetLoss + received)) * 100 : 0;
            jitter = (report.jitter ?? 0) * 1000; // convert to ms
            hasInbound = true;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
            hasCandidate = true;
          }
        });

        if (!hasInbound) return;

        let bitrate = 0;
        const now = Date.now();
        if (prevBytesRef.current) {
          const dt = (now - prevBytesRef.current.ts) / 1000;
          if (dt > 0) {
            bitrate = ((totalBytesReceived - prevBytesRef.current.received) * 8) / dt / 1000; // kbps
          }
        }
        prevBytesRef.current = { received: totalBytesReceived, ts: now };

        const level = computeQualityLevel({ bitrate, packetLoss, jitter, roundTripTime: rtt });
        const newStats: CallQualityStats = { bitrate: Math.round(bitrate), packetLoss: Math.round(packetLoss * 10) / 10, jitter: Math.round(jitter), roundTripTime: Math.round(rtt), level };
        setQualityStats(newStats);
      } catch { /* non-fatal */ }
    }, QUALITY_POLL_MS);
  }, []);

  // ── full cleanup ───────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleaningUp.current) return;
    cleaningUp.current = true;

    // Persist final quality stats
    if (qualityStats) persistQualityStats(qualityStats);

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;

    if (pc.current) {
      pc.current.onicecandidate = null;
      pc.current.ontrack = null;
      pc.current.onconnectionstatechange = null;
      pc.current.oniceconnectionstatechange = null;
      pc.current.close();
      pc.current = null;
    }

    // Cleanup group PCs
    groupPCs.current.forEach((gpc) => { gpc.close(); });
    groupPCs.current.clear();
    setRemoteStreams(new Map());
    setParticipantCount(0);

    setLocalStream(null);
    setRemoteStream(null);
    setActiveCallId(null);
    callIdRef.current = null;
    localStreamRef.current = null;
    setIsMuted(false);
    setIsVideoEnabled(false);
    setIsVideoCall(false);
    setIsScreenSharing(false);
    setQualityStats(null);
    connectedAtRef.current = null;
    setCallDuration(0);
    prevBytesRef.current = null;
    processedRemoteIceCounts.current.clear();

    if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    if (qualityTimer.current) { clearInterval(qualityTimer.current); qualityTimer.current = null; }
    reconnectTries.current = 0;

    cleaningUp.current = false;
  }, [setActiveCallId, qualityStats, persistQualityStats]);

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
        signaling.publishIceCandidate(callIdRef.current, e.candidate.toJSON()).catch(() => {});
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
        startQualityPolling();
      }
      if (s === 'disconnected') {
        if (reconnectTries.current < MAX_RECONNECT_TRIES) {
          reconnectTries.current++;
          setCallState('reconnecting');
          setTimeout(() => {
            try { peerConn.restartIce(); } catch { /* closed */ }
          }, RECONNECT_DELAY_MS);
        } else {
          const cid = callIdRef.current;
          if (cid) signaling.publishCallEnd(cid, 'failed').catch(() => {});
          cleanup();
          transitionToEnd('failed', 'connection_lost');
        }
      }
      if (s === 'failed') {
        const cid = callIdRef.current;
        if (cid) signaling.publishCallEnd(cid, 'failed').catch(() => {});
        cleanup();
        transitionToEnd('failed', 'ice_failed');
      }
    };

    return peerConn;
  }, [cleanup, startDurationTimer, startQualityPolling, transitionToEnd]);

  // ── request native mic/camera permissions (Android / iOS only) ───────
  // On native Capacitor, the OS requires explicit permission requests before
  // getUserMedia succeeds. On web the browser handles this natively.
  const requestNativePermissions = useCallback(async (video: boolean) => {
    if (!isNativeApp()) return; // browser handles its own prompts
    try {
      // Dynamically import to avoid bundling Capacitor plugins on web
      const { Permissions } = await import('@capacitor/core');
      // Check & request microphone
      const micStatus = await (Permissions as unknown as { query: (o: { name: string }) => Promise<{ state: string }> })
        .query({ name: 'microphone' });
      if (micStatus.state === 'denied') {
        throw new Error('Microphone permission denied. Please enable it in Settings.');
      }
      // Check & request camera only for video calls
      if (video) {
        const camStatus = await (Permissions as unknown as { query: (o: { name: string }) => Promise<{ state: string }> })
          .query({ name: 'camera' });
        if (camStatus.state === 'denied') {
          throw new Error('Camera permission denied. Please enable it in Settings.');
        }
      }
    } catch (err) {
      // Re-throw permission denials; swallow plugin-not-available errors
      // (older Capacitor versions that don't support Permissions.query)
      const msg = (err as Error)?.message ?? '';
      if (msg.includes('denied') || msg.includes('Settings')) throw err;
      // Otherwise non-fatal — getUserMedia will trigger the OS prompt itself
    }
  }, []);

  // ── get media (audio, optionally video) ───────────────────────────────
  const getMedia = useCallback(async (video = false) => {
    await requestNativePermissions(video);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    setLocalStream(stream);
    setIsVideoEnabled(video);
    setIsVideoCall(video);
    return stream;
  }, [requestNativePermissions]);

  // ── fire push notification for incoming call ──────────────────────────
  const sendCallPush = useCallback(async (callId: string, targetRoomId: string) => {
    try {
      // Get room members to notify
      const { data: members } = await supabase
        .from('chat_room_members' as never)
        .select('user_id')
        .eq('room_id', targetRoomId)
        .is('removed_at', null);

      if (!members) return;
      const others = (members as { user_id: string }[]).filter((m) => m.user_id !== userId);

      for (const m of others) {
        supabase.functions.invoke('push-send', {
          body: {
            user_id: m.user_id,
            title: '📞 Incoming call',
            body: 'Someone is calling you',
            data: { type: 'incoming_call', call_id: callId, room_id: targetRoomId },
          },
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }
  }, [userId]);

  // ── START CALL ────────────────────────────────────────────────────────
  const startCallFn = useCallback(async (video = false) => {
    if (!roomId || !userId || callState !== 'idle') return;
    try {
      // Probe all channels in parallel; populates availableChannels for routing
      signaling.isAvailable().catch(() => {});

      const stream = await getMedia(video);
      const callId = await signaling.initiateCall(roomId);
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

      // Broadcast SDP offer on all available channels simultaneously
      await signaling.publishOffer(callId, roomId, offer.sdp!, userId);

      // Send push notification
      sendCallPush(callId, roomId);

      // Ring timeout → missed
      ringTimer.current = setTimeout(async () => {
        if (callIdRef.current === callId) {
          await signaling.publishCallEnd(callId, 'no_answer').catch(() => {});
          cleanup();
          transitionToEnd('missed', 'no_answer');
        }
      }, RING_TIMEOUT_MS);

    } catch (err) {
      console.error('[WebRTC] startCall failed', err);
      cleanup();
      transitionToEnd('failed', 'start_error');
    }
  }, [roomId, userId, callState, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd, sendCallPush]);

  // ── ANSWER INCOMING ───────────────────────────────────────────────────
  const answerIncoming = useCallback(async () => {
    if (!incomingCall || !userId) return;
    try {
      const stream = await getMedia(false);
      const callId = incomingCall.id;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('connecting');
      setEndReason(null);

      const peerConn = buildPC();
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      // Try SDP offer from in-memory state first (delivered by WS channel,
      // stashed on the ChatCall object by the signaling useEffect below).
      // Fall back to a direct Supabase fetch for the Supabase channel path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let offerSdp: string | null = (incomingCall as any)._sdpOffer ?? null;
      if (!offerSdp) {
        const { data } = await supabase
          .from('chat_call_participants' as never)
          .select('sdp_offer')
          .eq('call_id', callId)
          .eq('user_id', incomingCall.initiated_by)
          .single();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        offerSdp = (data as any)?.sdp_offer ?? null;
      }
      if (!offerSdp) throw new Error('No SDP offer from initiator');

      await peerConn.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);

      await signaling.publishAnswer(callId, answer.sdp!);
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
    await signaling.publishCallEnd(incomingCall.id, 'declined').catch(() => {});
    setIncomingCall(null);
    useChatStore.getState().setIncomingCall(null, null);
    transitionToEnd('declined', 'declined');
  }, [incomingCall, signaling, transitionToEnd]);

  // ── HANG UP ───────────────────────────────────────────────────────────
  const hangUp = useCallback(async () => {
    const cid = callIdRef.current;
    if (cid) {
      await signaling.publishCallEnd(cid, 'ended').catch(() => {});
    }
    cleanup();
    transitionToEnd('ended', 'ended');
  }, [signaling, cleanup, transitionToEnd]);

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

    const videoTracks = localStream.getVideoTracks().filter((t) => t !== screenTrackRef.current);

    if (videoTracks.length > 0) {
      videoTracks.forEach((t) => { t.stop(); localStream.removeTrack(t); });
      const sender = pc.current.getSenders().find((s) => s.track?.kind === 'video' && s.track !== screenTrackRef.current);
      if (sender) await sender.replaceTrack(null);
      setIsVideoEnabled(false);
    } else {
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

  // ── SCREEN SHARE TOGGLE ───────────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (!pc.current || !localStream) return;

    if (isScreenSharing && screenTrackRef.current) {
      // Stop screen sharing
      screenTrackRef.current.stop();
      localStream.removeTrack(screenTrackRef.current);
      const sender = pc.current.getSenders().find((s) => s.track === screenTrackRef.current);
      if (sender) {
        // Replace with camera or null
        const camTrack = localStream.getVideoTracks().find((t) => t !== screenTrackRef.current) ?? null;
        await sender.replaceTrack(camTrack);
      }
      screenTrackRef.current = null;
      setIsScreenSharing(false);
    } else {
      // Start screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        // Replace or add the screen track
        const videoSender = pc.current.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        } else {
          pc.current.addTrack(screenTrack, localStream);
        }
        localStream.addTrack(screenTrack);

        // Listen for user stopping share via browser UI
        screenTrack.onended = () => {
          if (screenTrackRef.current === screenTrack) {
            localStream.removeTrack(screenTrack);
            const s = pc.current?.getSenders().find((snd) => snd.track === screenTrack);
            if (s) s.replaceTrack(null).catch(() => {});
            screenTrackRef.current = null;
            setIsScreenSharing(false);
          }
        };

        setIsScreenSharing(true);
        setIsVideoCall(true);
      } catch (err) {
        console.warn('[WebRTC] toggleScreenShare: failed', err);
      }
    }
  }, [localStream, isScreenSharing]);

  // ── SIGNALING: incoming calls + ICE + SDP answer ─────────────────────
  // Uses MultiSignalingChannel: Supabase Realtime (primary) + WebSocket relay
  // (fallback). Either channel delivering a message is sufficient.
  // If Supabase is blocked, the WS relay carries all signaling transparently.
  useEffect(() => {
    if (!roomId || !userId) return;

    const sig = signalingRef.current;
    if (!sig) return;

    // Non-blocking availability probe; populates availableChannels so
    // subsequent publish calls route correctly even before the first call.
    sig.isAvailable().catch(() => {});

    const handlers: SignalingHandlers = {
      // ── incoming call ──────────────────────────────────────────────────
      onIncomingCall: (callId, sdpOffer, initiatedBy) => {
        if (callIdRef.current) return; // already in a call
        const incoming = {
          id: callId,
          room_id: roomId,
          initiated_by: initiatedBy,
          status: 'ringing',
          started_at: new Date().toISOString(),
          connected_at: null,
          ended_at: null,
          duration_seconds: null,
          end_reason: null,
          ice_config: null,
          quality_stats: null,
          created_at: new Date().toISOString(),
          // Stash SDP offer when delivered by WS channel so answerIncoming
          // can use it without a Supabase round-trip in censored environments.
          ...(sdpOffer ? { _sdpOffer: sdpOffer } : {}),
        } as ChatCall;
        setIncomingCall(incoming);
        setCallState('ringing');
        useChatStore.getState().setIncomingCall(callId, roomId);
      },

      // ── SDP answer from callee ─────────────────────────────────────────
      onAnswer: (sdpAnswer) => {
        if (!pc.current || pc.current.signalingState !== 'have-local-offer') return;
        pc.current
          .setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
          .then(() => setCallState('connecting'))
          .catch(() => { /* already set or closed */ });
      },

      // ── trickle ICE candidate ──────────────────────────────────────────
      onIceCandidate: (candidate) => {
        if (!pc.current) return;
        pc.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { /* stale */ });
      },

      // ── remote ended / cancelled ───────────────────────────────────────
      onCallEnd: (reason) => {
        if (callIdRef.current) {
          cleanup();
          if (reason === 'declined') {
            transitionToEnd('declined', 'remote_declined');
          } else {
            transitionToEnd('ended', 'remote_ended');
          }
        } else if (incomingCallRef.current) {
          setIncomingCall(null);
          useChatStore.getState().setIncomingCall(null, null);
          transitionToEnd('missed', 'caller_cancelled');
        }
      },
    };

    const unsubscribe = sig.subscribe(null, roomId, userId, handlers);

    return () => {
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  // ── beforeunload: cleanup on tab close ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callIdRef.current) {
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/chat_end_call?apikey=${encodeURIComponent(anonKey)}`;
        const body = JSON.stringify({ _call_id: callIdRef.current, _end_reason: 'tab_closed' });

        const sessionStr = localStorage.getItem('sb-' + import.meta.env.VITE_SUPABASE_PROJECT_ID + '-auth-token');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': anonKey,
        };
        if (sessionStr) {
          try {
            const session = JSON.parse(sessionStr);
            if (session?.access_token) {
              headers['Authorization'] = `Bearer ${session.access_token}`;
            }
          } catch { /* ignore */ }
        }

        try {
          fetch(url, {
            method: 'POST',
            headers,
            body,
            keepalive: true,
          }).catch(() => {});
        } catch {
          try { navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); } catch { /* */ }
        }
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenTrackRef.current?.stop();
      pc.current?.close();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (callIdRef.current) {
        signalingRef.current?.publishCallEnd(callIdRef.current, 'navigated_away').catch(() => {});
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
        signalingRef.current?.publishCallEnd(callIdRef.current, 'room_changed').catch(() => {});
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
    toggleScreenShare,
    isMuted,
    isVideoEnabled,
    isVideoCall,
    isScreenSharing,
    callDuration,
    endReason,
    qualityStats,
    remoteStreams,
    participantCount,
  };
}
