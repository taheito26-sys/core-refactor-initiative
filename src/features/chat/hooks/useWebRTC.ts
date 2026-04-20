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
import {
  startCallSession, joinCallSession, endCallSession,
  type CallSessionCredentials,
} from '../api/call-session';
import { useChatStore } from '@/lib/chat-store';
import { MultiSignalingChannel } from '../lib/signaling/multi-channel';
import type { SignalingHandlers } from '../lib/signaling/types';
import type { ChatCall } from '../types';
import { isNativeApp } from '@/platform/runtime';
import { getSignalingConfig } from '../lib/signaling/config';

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
  // Audio element ref — exposed so CallOverlay can resume playback after
  // screen lock / page visibility restore without re-mounting the element.
  remoteAudioRef:    React.RefObject<HTMLAudioElement | null>;
}

const RECONNECT_DELAY_MS  = 2_000;
const MAX_RECONNECT_TRIES = 5;
const RING_TIMEOUT_MS     = 45_000;
const END_STATE_LINGER_MS = 3_000;
const QUALITY_POLL_MS     = 3_000;
const OFFER_FETCH_RETRY_MS = 150;
const OFFER_FETCH_MAX_ATTEMPTS = 20;

function computeQualityLevel(stats: Omit<CallQualityStats, 'level'>): CallQualityStats['level'] {
  if (stats.packetLoss > 10 || stats.roundTripTime > 400 || stats.jitter > 100) return 'poor';
  if (stats.packetLoss > 3 || stats.roundTripTime > 200 || stats.jitter > 50) return 'good';
  return 'excellent';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type IncomingCallState = ChatCall & {
  _sdpOffer?: string;
  _wantsVideo?: boolean;
};

function sdpWantsVideo(sdp: string | null | undefined): boolean {
  return typeof sdp === 'string' && /\bm=video\b/.test(sdp);
}

function getMediaFailureReason(error: unknown, requestedVideo: boolean): string {
  const name = typeof error === 'object' && error && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message).toLowerCase()
    : '';

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    message.includes('permission') ||
    message.includes('denied')
  ) {
    return requestedVideo ? 'camera_permission_denied' : 'microphone_permission_denied';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return requestedVideo ? 'camera_unavailable' : 'microphone_unavailable';
  }

  return requestedVideo ? 'video_setup_failed' : 'audio_setup_failed';
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
  const qualityStatsRef = useRef<CallQualityStats | null>(null);
  const screenTrackRef  = useRef<MediaStreamTrack | null>(null);
  const prevBytesRef    = useRef<{ received: number; ts: number } | null>(null);
  const processedRemoteIceCounts = useRef<Map<string, number>>(new Map());
  // Exposed to CallOverlay so it can resume playback after screen lock
  const remoteAudioRef  = useRef<HTMLAudioElement | null>(null);
  // Trickle-ICE candidates that arrive before setRemoteDescription completes
  // are rejected by RTCPeerConnection with "remote description was null".
  // Buffer them until remoteDescription is present, then flush in order.
  const pendingRemoteIce = useRef<RTCIceCandidateInit[]>([]);
  // Group calls: map of peerId → RTCPeerConnection
  const groupPCs        = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Multi-channel signaling (Supabase + WS relay; lazy init once per mount)
  const signalingRef    = useRef<MultiSignalingChannel | null>(null);
  if (!signalingRef.current) {
    signalingRef.current = MultiSignalingChannel.create();
  }
  const signaling = signalingRef.current;

  // Keep WS channel auth token in sync with session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      signaling.setAuthToken(session?.access_token ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      signaling.setAuthToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [signaling]);

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

  // Keep qualityStatsRef in sync with state
  useEffect(() => {
    qualityStatsRef.current = qualityStats;
  }, [qualityStats]);

  // ── full cleanup ───────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleaningUp.current) return;
    cleaningUp.current = true;

    // Persist final quality stats via ref (avoids stale closure)
    const finalStats = qualityStatsRef.current;
    if (finalStats) persistQualityStats(finalStats);

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

    incomingCallRef.current = null;
    setIncomingCall(null);
    useChatStore.getState().setIncomingCall(null, null);
    signaling.setRelayAuthToken(null);
    setLocalStream(null);
    setRemoteStream(null);
    // Disconnect AudioContext source when call ends
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
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
    pendingRemoteIce.current = [];

    if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null; }
    if (qualityTimer.current) { clearInterval(qualityTimer.current); qualityTimer.current = null; }
    reconnectTries.current = 0;

    cleaningUp.current = false;
  }, [setActiveCallId, persistQualityStats]);

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

  // ── flush ICE candidates buffered during setRemoteDescription race ────
  // Trickle-ICE delivers candidates over signaling independently of SDP.
  // When a candidate arrives before pc.remoteDescription is set,
  // addIceCandidate rejects with InvalidStateError and the candidate is
  // lost. We buffer such candidates and apply them once remoteDescription
  // is present.
  const flushPendingRemoteIce = useCallback(() => {
    const peerConn = pc.current;
    if (!peerConn || !peerConn.remoteDescription) return;
    const queued = pendingRemoteIce.current;
    pendingRemoteIce.current = [];
    if (queued.length === 0) return;
    console.log(`[ICE_REMOTE_FLUSH] count=${queued.length}`);
    for (const c of queued) {
      peerConn.addIceCandidate(new RTCIceCandidate(c))
        .then(() => console.log('[ICE_REMOTE_OK] type=buffered'))
        .catch((err) => console.warn('[ICE_REMOTE_FAIL] type=buffered', err));
    }
  }, []);

  // ── build peer connection ─────────────────────────────────────────────
  const buildPC = useCallback((iceConfig: RTCConfiguration = DEFAULT_ICE_CONFIG) => {
    // Fresh connection → discard any candidates buffered for a previous call.
    pendingRemoteIce.current = [];
    let peerConn: RTCPeerConnection;
    try {
      peerConn = new RTCPeerConnection(iceConfig);
    } catch (err) {
      console.error('[WebRTC] RTCPeerConnection construction failed, retrying with minimal config', {
        error: (err as Error).message,
        iceServers: iceConfig.iceServers,
      });
      peerConn = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
    }

    peerConn.onicecandidate = (e) => {
      if (e.candidate && callIdRef.current) {
        const candidateType = e.candidate.type ?? e.candidate.candidate?.match(/typ (\w+)/)?.[1] ?? 'unknown';
        console.log(`[ICE_CANDIDATE] type=${candidateType} protocol=${e.candidate.protocol ?? 'unknown'} address=${e.candidate.address ?? 'hidden'}`);
        signaling.publishIceCandidate(callIdRef.current, e.candidate.toJSON()).catch(() => {});
      }
    };

    peerConn.ontrack = (e) => {
      setRemoteStream(e.streams[0] ?? null);
    };

    peerConn.onconnectionstatechange = () => {
      const s = peerConn.connectionState;
      console.log(`[ICE_STATE] connectionState=${s} iceConnectionState=${peerConn.iceConnectionState}`);
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
        // Collect stats BEFORE cleanup so the PC is still alive. Chrome's
        // RTCPeerConnection.getStats() returns empty results for closed PCs
        // even if the Promise was started pre-close. Await explicitly.
        (async () => {
          try {
            const stats = await peerConn.getStats();
            const pairs: unknown[] = [];
            const locals: Record<string, unknown> = {};
            const remotes: Record<string, unknown> = {};
            stats.forEach((r) => {
              if (r.type === 'candidate-pair') pairs.push(r);
              if (r.type === 'local-candidate') locals[r.id] = r;
              if (r.type === 'remote-candidate') remotes[r.id] = r;
            });
            const localSdp = peerConn.localDescription?.sdp ?? '';
            const remoteSdp = peerConn.remoteDescription?.sdp ?? '';
            const localUfrag = localSdp.match(/a=ice-ufrag:(\S+)/)?.[1] ?? null;
            const remoteUfrag = remoteSdp.match(/a=ice-ufrag:(\S+)/)?.[1] ?? null;
            const signalingState = peerConn.signalingState;
            const iceGatheringState = peerConn.iceGatheringState;
            console.warn(
              '[ICE_FAIL_DIAG]',
              JSON.stringify(
                {
                  signalingState,
                  iceGatheringState,
                  localUfrag,
                  remoteUfrag,
                  pairs,
                  locals,
                  remotes,
                },
                null,
                2,
              ),
            );
          } catch (err) {
            console.warn('[ICE_FAIL_DIAG] getStats threw', err);
          } finally {
            const cid = callIdRef.current;
            if (cid) signaling.publishCallEnd(cid, 'failed').catch(() => {});
            cleanup();
            transitionToEnd('failed', 'ice_failed');
          }
        })();
      }
    };

    peerConn.oniceconnectionstatechange = () => {
      const iceState = peerConn.iceConnectionState;
      console.log(`[ICE_STATE] iceConnectionState=${iceState} connectionState=${peerConn.connectionState}`);

      if (iceState === 'connected' || iceState === 'completed') {
        setCallState('connected');
        reconnectTries.current = 0;
        if (ringTimer.current) { clearTimeout(ringTimer.current); ringTimer.current = null; }
        if (!connectedAtRef.current) {
          startDurationTimer();
        }
        startQualityPolling();
      }

      if (iceState === 'failed') {
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
      // On native Capacitor, getUserMedia triggers OS permission prompts automatically.
      // We just do a light pre-check via navigator.permissions if available.
      if (navigator.permissions) {
        const micStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (micStatus.state === 'denied') {
          throw new Error('Microphone permission denied. Please enable it in Settings.');
        }
        if (video) {
          const camStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (camStatus.state === 'denied') {
            throw new Error('Camera permission denied. Please enable it in Settings.');
          }
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
    // Create AudioContext HERE — inside the user gesture (startCall/answerIncoming tap)
    // so it's not immediately suspended by the browser's autoplay policy.
    initAudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    setLocalStream(stream);
    setIsVideoEnabled(video);
    setIsVideoCall(video);
    return stream;
  }, [requestNativePermissions, initAudioContext]);

  // ── wait for ICE gathering to complete (or timeout) ───────────────────
  // Ensures relay candidates are allocated before publishing the offer.
  // Without this, the offer contains only host/srflx candidates; relay
  // candidates arrive late via trickle ICE, and if the remote peer's ICE
  // agent times out before they arrive, no pairs form → ICE fails.
  const waitForIceGathering = useCallback((peerConn: RTCPeerConnection, timeoutMs = 3000): Promise<void> => {
    return new Promise((resolve) => {
      if (peerConn.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        console.warn('[ICE_GATHER] timeout — proceeding with partial candidates');
        resolve();
      }, timeoutMs);
      peerConn.addEventListener('icegatheringstatechange', function onGather() {
        if (peerConn.iceGatheringState === 'complete') {
          clearTimeout(timer);
          peerConn.removeEventListener('icegatheringstatechange', onGather);
          console.log('[ICE_GATHER] complete');
          resolve();
        }
      });
    });
  }, []);

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
    const config = getSignalingConfig();
    let startedCallId: string | null = null;
    try {
      // Probe all channels in parallel; populates availableChannels for routing
      signaling.isAvailable().catch(() => {});

      const stream = await getMedia(video);

      let callId: string;
      let iceConfig = DEFAULT_ICE_CONFIG;

      if (config.useCallSession) {
        // ── New path: call-session edge function ──────────────────────────
        // Returns call_id + signaling credentials in one round-trip.
        // The edge function handles room membership, policy checks, and
        // call record creation server-side.
        try {
          const creds: CallSessionCredentials = await startCallSession(roomId);
          callId = creds.call_id;
          if (creds.ice_config) iceConfig = creds.ice_config as typeof DEFAULT_ICE_CONFIG;

          // Warn if no TURN servers — cross-network calls behind symmetric NAT will fail
          const hasTurn = (iceConfig.iceServers ?? []).some((s) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u) => typeof u === 'string' && u.startsWith('turn'));
          });
          if (!hasTurn) {
            console.warn('[WebRTC] startCall: ICE config has no TURN servers — cross-network calls behind symmetric NAT may fail. Configure CLOUDFLARE_TURN_TOKEN or TURN_URL on the call-session edge function.');
          }

          // Propagate callId to signaling channels BEFORE setting relay URLs
          // so the WS channel connects with the correct callId in the query string.
          signaling.updateActiveCallId(callId);

          // If relay URL + token provided, configure WS channel
          if (creds.token) {
            signaling.setRelayAuthToken(creds.token);
          }
          if (creds.signaling_url) {
            signaling.setRelayUrls([creds.signaling_url]);
          }
        } catch (edgeFnErr) {
          console.warn('[WebRTC] call-session edge fn failed, falling back to RPC', edgeFnErr);
          // Fallback: use existing RPC path.
          // Keep iceConfig as DEFAULT_ICE_CONFIG (resilient-ice.ts STUN list).
          // TURN credentials won't be available in this path, but STUN will work
          // for non-symmetric NAT. Cross-network calls behind symmetric NAT require
          // TURN — configure CLOUDFLARE_TURN_TOKEN or TURN_URL on the edge function.
          callId = await signaling.initiateCall(roomId);
        }
      } else {
        // Legacy path: direct Supabase RPC
        callId = await signaling.initiateCall(roomId);
      }

      startedCallId = callId;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('calling');
      setEndReason(null);

      const peerConn = buildPC(iceConfig);
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      const offer = await peerConn.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: video,
      });
      await peerConn.setLocalDescription(offer);

      // Wait for ICE gathering to complete (or timeout after 3s).
      // This ensures relay candidates are included in the offer SDP,
      // rather than arriving late via trickle ICE and racing the remote
      // peer's ICE timeout.
      await waitForIceGathering(peerConn);

      // Use the final local description SDP (includes all gathered candidates)
      // rather than the initial offer.sdp (which may lack relay candidates).
      const finalOfferSdp = peerConn.localDescription?.sdp ?? offer.sdp!;

      // Broadcast SDP offer on all available channels simultaneously
      await signaling.publishOffer(callId, roomId, finalOfferSdp, userId);

      // Send push notification
      sendCallPush(callId, roomId);

      // Ring timeout → missed
      ringTimer.current = setTimeout(async () => {
        if (callIdRef.current === callId) {
          if (config.useCallSession) {
            endCallSession(callId, 'no_answer').catch(() => {});
          }
          await signaling.publishCallEnd(callId, 'no_answer').catch(() => {});
          cleanup();
          transitionToEnd('missed', 'no_answer');
        }
      }, RING_TIMEOUT_MS);

    } catch (err) {
      console.error('[WebRTC] startCall failed', err);
      if (startedCallId) {
        if (config.useCallSession) {
          endCallSession(startedCallId, 'failed').catch(() => {});
        }
        await signaling.publishCallEnd(startedCallId, 'failed').catch(() => {});
      }
      cleanup();
      transitionToEnd('failed', getMediaFailureReason(err, video));
    }
  }, [roomId, userId, callState, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd, sendCallPush, signaling, waitForIceGathering]);

  // ── ANSWER INCOMING ───────────────────────────────────────────────────
  const answerIncoming = useCallback(async () => {
    if (!incomingCall || !userId) return;
    const config = getSignalingConfig();
    const currentIncoming = incomingCall as IncomingCallState;
    let wantsVideo = currentIncoming._wantsVideo ?? false;
    let iceConfig: RTCConfiguration = DEFAULT_ICE_CONFIG;
    try {
      const callId = currentIncoming.id;
      callIdRef.current = callId;
      setActiveCallId(callId);
      setCallState('connecting');
      setEndReason(null);

      // ── New path: join via edge function for server-side validation ────
      if (config.useCallSession && roomId) {
        try {
          const creds = await joinCallSession(roomId, callId);
          if (creds.ice_config) {
            iceConfig = creds.ice_config as RTCConfiguration;
            const hasTurn = (iceConfig.iceServers ?? []).some((s) => {
              const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
              return urls.some((u) => typeof u === 'string' && u.startsWith('turn'));
            });
            if (!hasTurn) {
              console.warn('[WebRTC] answerIncoming: ICE config has no TURN servers — cross-network calls behind symmetric NAT may fail');
            }
          }
          // Propagate callId to signaling channels BEFORE setting relay URLs
          signaling.updateActiveCallId(callId);
          if (creds.token) {
            signaling.setRelayAuthToken(creds.token);
          }
          if (creds.signaling_url) {
            signaling.setRelayUrls([creds.signaling_url]);
          }
        } catch (edgeFnErr) {
          console.warn('[WebRTC] call-session join failed, continuing with direct signaling', edgeFnErr);
        }
      }

      // Try SDP offer from in-memory state first (delivered by WS channel,
      // stashed on the ChatCall object by the signaling useEffect below).
      // Fall back to a direct Supabase fetch for the Supabase channel path.
      let offerSdp: string | null = currentIncoming._sdpOffer ?? null;
      if (!offerSdp) {
        for (let attempt = 0; attempt < OFFER_FETCH_MAX_ATTEMPTS && !offerSdp; attempt++) {
          const { data, error } = await supabase
            .from('chat_call_participants' as never)
            .select('sdp_offer')
            .eq('call_id', callId)
            .eq('user_id', currentIncoming.initiated_by)
            .maybeSingle();

          if (error) {
            throw error;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          offerSdp = (data as any)?.sdp_offer ?? null;
          if (!offerSdp) {
            await wait(OFFER_FETCH_RETRY_MS);
          }
        }
      }
      if (!offerSdp) throw new Error('No SDP offer from initiator');

      wantsVideo = sdpWantsVideo(offerSdp);
      const stream = await getMedia(wantsVideo);

      const peerConn = buildPC(iceConfig);
      pc.current = peerConn;
      stream.getTracks().forEach((t) => peerConn.addTrack(t, stream));

      await peerConn.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      flushPendingRemoteIce();
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);

      {
        const remoteUfrag = offerSdp.match(/a=ice-ufrag:(\S+)/)?.[1] ?? '?';
        const localUfrag = answer.sdp?.match(/a=ice-ufrag:(\S+)/)?.[1] ?? '?';
        console.log(`[SDP_UFRAG] local=${localUfrag} remote=${remoteUfrag}`);
      }

      // Wait for ICE gathering before publishing the answer so relay
      // candidates are included in the answer SDP.
      await waitForIceGathering(peerConn);
      const finalAnswerSdp = peerConn.localDescription?.sdp ?? answer.sdp!;

      await signaling.publishAnswer(callId, finalAnswerSdp);
      incomingCallRef.current = null;
      setIncomingCall(null);
      useChatStore.getState().setIncomingCall(null, null);

    } catch (err) {
      console.error('[WebRTC] answerIncoming failed', err);
      if (currentIncoming.id) {
        if (config.useCallSession) {
          endCallSession(currentIncoming.id, 'failed').catch(() => {});
        }
        await signaling.publishCallEnd(currentIncoming.id, 'failed').catch(() => {});
      }
      incomingCallRef.current = null;
      setIncomingCall(null);
      useChatStore.getState().setIncomingCall(null, null);
      cleanup();
      transitionToEnd('failed', getMediaFailureReason(err, wantsVideo));
    }
  }, [incomingCall, userId, roomId, getMedia, buildPC, setActiveCallId, cleanup, transitionToEnd, signaling, flushPendingRemoteIce, waitForIceGathering]);

  // ── DECLINE ───────────────────────────────────────────────────────────
  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    await signaling.publishCallEnd(incomingCall.id, 'declined').catch(() => {});
    incomingCallRef.current = null;
    setIncomingCall(null);
    useChatStore.getState().setIncomingCall(null, null);
    transitionToEnd('declined', 'declined');
  }, [incomingCall, signaling, transitionToEnd]);

  // ── HANG UP ───────────────────────────────────────────────────────────
  const hangUp = useCallback(async () => {
    const cid = callIdRef.current;
    if (cid) {
      // Use edge function for authoritative call end
      const config = getSignalingConfig();
      if (config.useCallSession) {
        endCallSession(cid, 'ended').catch(() => {});
      }
      await signaling.publishCallEnd(cid, 'ended').catch(() => {});
    }
    cleanup();
    transitionToEnd('ended', 'ended');
  }, [signaling, cleanup, transitionToEnd]);

  // ── MUTE ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    // Use localStreamRef (always current) not localStream (may be stale closure)
    const stream = localStreamRef.current;
    if (!stream) return;
    const newMuted = !isMuted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setIsMuted(newMuted);
  }, [isMuted]);

  // ── VIDEO TOGGLE ──────────────────────────────────────────────────────
  const toggleVideo = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !pc.current) return;

    const videoTracks = stream.getVideoTracks().filter((t) => t !== screenTrackRef.current);

    if (videoTracks.length > 0) {
      // Turn video OFF — stop tracks and null out the sender
      videoTracks.forEach((t) => { t.stop(); stream.removeTrack(t); });
      const sender = pc.current.getSenders().find((s) => s.track?.kind === 'video' && s.track !== screenTrackRef.current);
      if (sender) await sender.replaceTrack(null);
      setIsVideoEnabled(false);
    } else {
      // Turn video ON — get camera and renegotiate
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        stream.addTrack(videoTrack);

        // Find an existing null/video sender to replace, or add a new track
        const sender = pc.current.getSenders().find((s) => s.track === null || s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        } else {
          // New track — must renegotiate so remote peer gets video
          pc.current.addTrack(videoTrack, stream);
          const offer = await pc.current.createOffer();
          await pc.current.setLocalDescription(offer);
          if (callIdRef.current && roomIdRef.current && userId) {
            signaling.publishOffer(callIdRef.current, roomIdRef.current, offer.sdp!, userId).catch(() => {});
          }
        }
        setIsVideoEnabled(true);
        setIsVideoCall(true);
      } catch (err) {
        console.warn('[WebRTC] toggleVideo: camera access failed', err);
      }
    }
  }, [signaling, userId]);

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
      // ── incoming call OR renegotiation offer ──────────────────────────
      onIncomingCall: (callId, sdpOffer, initiatedBy) => {
        // If we're already in a connected call and receive an offer with the
        // same callId, it's a renegotiation (e.g. remote peer added video).
        if (callIdRef.current === callId && pc.current && sdpOffer) {
          const sigState = pc.current.signalingState;
          if (sigState === 'stable' || sigState === 'have-remote-offer') {
            pc.current.setRemoteDescription({ type: 'offer', sdp: sdpOffer })
              .then(() => pc.current!.createAnswer())
              .then(async (answer) => {
                await pc.current!.setLocalDescription(answer);
                signaling.publishAnswer(callId, answer.sdp!).catch(() => {});
              })
              .catch(() => {});
          }
          return;
        }
        if (callIdRef.current && callIdRef.current !== callId) return; // already in another call
        if (incomingCallRef.current?.id === callId) {
          if (sdpOffer) {
            incomingCallRef.current = {
              ...incomingCallRef.current,
              _sdpOffer: sdpOffer,
              _wantsVideo: sdpWantsVideo(sdpOffer),
            } as IncomingCallState;
            setIncomingCall((prev) => (
              prev?.id === callId
                ? ({ ...prev, _sdpOffer: sdpOffer, _wantsVideo: sdpWantsVideo(sdpOffer) } as IncomingCallState)
                : prev
            ));
          }
          return;
        }
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
          ...(sdpOffer ? { _sdpOffer: sdpOffer, _wantsVideo: sdpWantsVideo(sdpOffer) } : {}),
        } as IncomingCallState;
        incomingCallRef.current = incoming;
        setIncomingCall(incoming);
        setCallState('ringing');
        useChatStore.getState().setIncomingCall(callId, roomId);
      },

      // ── SDP answer from callee ─────────────────────────────────────────
      onAnswer: (sdpAnswer) => {
        if (!pc.current) return;
        // Accept answers in both have-local-offer (initial) and stable (renegotiation)
        const sigState = pc.current.signalingState;
        if (sigState !== 'have-local-offer' && sigState !== 'stable') return;
        const isRenegotiation = sigState === 'stable';
        pc.current
          .setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
          .then(() => {
            const remoteUfrag = sdpAnswer.match(/a=ice-ufrag:(\S+)/)?.[1] ?? '?';
            const localSdp = pc.current?.localDescription?.sdp ?? '';
            const localUfrag = localSdp.match(/a=ice-ufrag:(\S+)/)?.[1] ?? '?';
            console.log(`[SDP_UFRAG] local=${localUfrag} remote=${remoteUfrag}`);
            flushPendingRemoteIce();
            // Only transition to 'connecting' for the initial call setup.
            // Renegotiation answers (e.g. adding video) must not reset state.
            if (!isRenegotiation) {
              setCallState('connecting');
            }
          })
          .catch(() => { /* already set or closed */ });
      },

      // ── trickle ICE candidate ──────────────────────────────────────────
      onIceCandidate: (candidate) => {
        if (!pc.current) return;
        const candStr = (candidate as RTCIceCandidateInit).candidate ?? '';
        const typ = candStr.match(/typ (\w+)/)?.[1] ?? 'unknown';
        const proto = candStr.match(/(?:udp|tcp)/i)?.[0] ?? '?';
        const ufrag =
          candStr.match(/ufrag (\S+)/)?.[1] ??
          (candidate as RTCIceCandidateInit).usernameFragment ??
          '?';
        console.log(`[ICE_REMOTE] type=${typ} protocol=${proto} ufrag=${ufrag}`);

        // Remote description not set yet → buffer, flush later.
        if (!pc.current.remoteDescription) {
          pendingRemoteIce.current.push(candidate);
          console.log(`[ICE_REMOTE_BUFFER] type=${typ} queued=${pendingRemoteIce.current.length}`);
          return;
        }

        pc.current.addIceCandidate(new RTCIceCandidate(candidate))
          .then(() => console.log(`[ICE_REMOTE_OK] type=${typ} ufrag=${ufrag}`))
          .catch((err) => console.warn(`[ICE_REMOTE_FAIL] type=${typ}`, err));
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
          incomingCallRef.current = null;
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
  }, [roomId, userId, cleanup, transitionToEnd, flushPendingRemoteIce]);

  // ── page lifecycle: keep audio alive through screen lock / background ──
  //
  // Problem: Mobile browsers suspend media when screen locks or app backgrounds.
  //   - Android Chrome: AudioContext suspends, <audio> pauses
  //   - iOS Safari: everything stops, no background audio for web apps
  //
  // AudioContext MUST be created during a user gesture (tap) to avoid being
  // immediately suspended. We create it in getMedia() which is called from
  // startCall/answerIncoming — both triggered by user taps.
  //
  // On visibility restore: resume AudioContext + replay <audio> + check mic.

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Called from getMedia() (inside startCall/answerIncoming user gesture)
  // to create the AudioContext while we still have gesture context.
  const initAudioContext = useCallback(() => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
    } catch { /* not available */ }
  }, []);

  // Wire remote stream through AudioContext for background-resilient playback.
  // Called after remoteStream is set (ontrack fires).
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!remoteStream) return;

    // <audio> element — fallback and for browsers without AudioContext
    if (el && el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(() => {});
    }

    // AudioContext routing — survives Android Chrome backgrounding
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;

    audioSourceRef.current?.disconnect();
    try {
      const source = ctx.createMediaStreamSource(remoteStream);
      source.connect(ctx.destination);
      audioSourceRef.current = source;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { /* non-fatal */ }

    return () => {
      audioSourceRef.current?.disconnect();
      audioSourceRef.current = null;
    };
  }, [remoteStream, remoteAudioRef]);

  useEffect(() => {
    const resumeAll = async () => {
      // 1. Resume AudioContext
      try {
        if (audioCtxRef.current?.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
      } catch { /**/ }

      // 2. Resume <audio> element
      const el = remoteAudioRef.current;
      if (el?.paused && el.srcObject) {
        el.play().catch(() => {});
      }

      // 3. Re-wire AudioContext source in case it was disconnected
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'running' && remoteStream && !audioSourceRef.current) {
        try {
          const source = ctx.createMediaStreamSource(remoteStream);
          source.connect(ctx.destination);
          audioSourceRef.current = source;
        } catch { /**/ }
      }

      // 4. Check if local mic tracks are still alive after screen lock.
      // On Android Chrome the tracks stay 'live' but stop sending audio.
      // We restart them unconditionally on resume to be safe.
      const stream = localStreamRef.current;
      if (!stream || !pc.current || !callIdRef.current) return;

      const audioTracks = stream.getAudioTracks();
      const needsRestart = audioTracks.length === 0 ||
        audioTracks.some(t => t.readyState === 'ended');

      if (needsRestart) {
        console.log('[WebRTC] mic tracks ended — restarting');
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const newTrack = newStream.getAudioTracks()[0];
          const sender = pc.current.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) await sender.replaceTrack(newTrack);
          audioTracks.forEach(t => { t.stop(); stream.removeTrack(t); });
          stream.addTrack(newTrack);
          newTrack.enabled = !isMuted;
          console.log('[WebRTC] mic restarted');
        } catch (err) {
          console.warn('[WebRTC] mic restart failed', err);
        }
      } else {
        // Re-enable tracks in case OS muted them at hardware level
        audioTracks.forEach(t => { if (t.readyState === 'live') t.enabled = !isMuted; });
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) setTimeout(() => void resumeAll(), 200);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setTimeout(() => void resumeAll(), 200);
    };
    const onResume = () => setTimeout(() => void resumeAll(), 200);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('resume', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('resume', onResume);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteAudioRef, isMuted, remoteStream]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      audioSourceRef.current?.disconnect();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── beforeunload: cleanup on tab close ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      const unloadCallId = callIdRef.current ?? incomingCallRef.current?.id;
      const unloadReason = callIdRef.current ? 'tab_closed' : 'declined';
      if (unloadCallId) {
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/chat_end_call?apikey=${encodeURIComponent(anonKey)}`;
        const body = JSON.stringify({ _call_id: unloadCallId, _end_reason: unloadReason });

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
      } else if (incomingCallRef.current) {
        signalingRef.current?.publishCallEnd(incomingCallRef.current.id, 'declined').catch(() => {});
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
      } else if (incomingCallRef.current) {
        signalingRef.current?.publishCallEnd(incomingCallRef.current.id, 'declined').catch(() => {});
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
    remoteAudioRef,
  };
}
