import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCallStore } from '@/lib/call-store';

interface Props {
  roomId: string | null;
  userId: string;
  onTimelineEvent?: (eventType: string, details?: string[]) => void;
}

const CALL_TIMEOUT_MS = 30_000;

export function useWebRTC({ roomId, userId, onTimelineEvent }: Props) {
  const { callState, isIncoming, activeSessionId, callerId, isVideo, setCall, resetCall } = useCallStore();
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCallTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback((reason: 'ended' | 'missed' | 'rejected' | 'failed' = 'ended') => {
    clearCallTimeout();
    pcRef.current?.close();
    pcRef.current = null;
    pendingOfferRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    if (reason === 'missed') {
      onTimelineEvent?.('call_missed');
    } else if (reason === 'rejected') {
      onTimelineEvent?.('call_rejected');
    } else if (reason === 'failed') {
      onTimelineEvent?.('call_failed');
    } else {
      onTimelineEvent?.('call_ended');
    }
    resetCall();
  }, [localStream, resetCall, clearCallTimeout, onTimelineEvent]);

  const setupPC = useCallback((sessionId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate && roomId) {
        supabase.channel(`room:${roomId}:calls`).send({
          type: 'broadcast',
          event: 'candidate',
          payload: { candidate: e.candidate, sessionId, from: userId },
        });
      }
    };

    pc.ontrack = (e) => {
      if (e.streams[0]) setRemoteStream(e.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (!pcRef.current) return;
      const state = pcRef.current.connectionState;
      if (state === 'connected') {
        setCall('connected', isIncoming, callerId, sessionId, isVideo);
      }
      if (state === 'failed' || state === 'disconnected') {
        cleanup('failed');
      }
    };

    pcRef.current = pc;
    return pc;
  }, [roomId, userId, setCall, isIncoming, callerId, isVideo, cleanup]);

  const initiateCall = useCallback(async (is_video: boolean) => {
    if (!roomId) return;
    const sessionId = Math.random().toString(36).slice(2);
    setCall('ringing', false, userId, sessionId, is_video);
    onTimelineEvent?.('call_started');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: is_video });
    setLocalStream(stream);

    const pc = setupPC(sessionId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    supabase.channel(`room:${roomId}:calls`).send({
      type: 'broadcast',
      event: 'offer',
      payload: { offer, sessionId, from: userId, is_video },
    });

    clearCallTimeout();
    timeoutRef.current = setTimeout(() => {
      if (callState === 'ringing') {
        cleanup('missed');
      }
    }, CALL_TIMEOUT_MS);
  }, [roomId, userId, setupPC, setCall, onTimelineEvent, clearCallTimeout, callState, cleanup]);

  const handleOffer = useCallback(async (payload: any) => {
    if (payload.from === userId) return;
    pendingOfferRef.current = payload.offer;
    setCall('ringing', true, payload.from, payload.sessionId, payload.is_video);
    clearCallTimeout();
    timeoutRef.current = setTimeout(() => {
      cleanup('missed');
    }, CALL_TIMEOUT_MS);
  }, [userId, setCall, clearCallTimeout, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!roomId || !activeSessionId || !pendingOfferRef.current) return;
    setCall('connecting', true, callerId, activeSessionId, isVideo);
    clearCallTimeout();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
    setLocalStream(stream);

    const pc = setupPC(activeSessionId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    supabase.channel(`room:${roomId}:calls`).send({
      type: 'broadcast',
      event: 'answer',
      payload: { answer, sessionId: activeSessionId, from: userId },
    });

    onTimelineEvent?.('call_accepted');
  }, [roomId, activeSessionId, setupPC, setCall, isVideo, userId, onTimelineEvent, clearCallTimeout, callerId]);

  const rejectCall = useCallback(() => {
    if (roomId && activeSessionId) {
      supabase.channel(`room:${roomId}:calls`).send({
        type: 'broadcast',
        event: 'reject',
        payload: { sessionId: activeSessionId, from: userId },
      });
    }
    cleanup('rejected');
  }, [roomId, activeSessionId, userId, cleanup]);

  const toggleMute = useCallback((muted: boolean) => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [localStream]);

  const endCall = useCallback(() => {
    if (roomId && activeSessionId) {
      supabase.channel(`room:${roomId}:calls`).send({
        type: 'broadcast',
        event: 'hangup',
        payload: { sessionId: activeSessionId, from: userId },
      });
    }
    cleanup('ended');
  }, [roomId, activeSessionId, userId, cleanup]);

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`room:${roomId}:calls`);
    channel
      .on('broadcast', { event: 'offer' }, (payload) => handleOffer(payload.payload))
      .on('broadcast', { event: 'answer' }, async (payload) => {
        const { answer, sessionId, from } = payload.payload;
        if (from !== userId && sessionId === activeSessionId && pcRef.current) {
          clearCallTimeout();
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          setCall('connected', false, from, sessionId, isVideo);
        }
      })
      .on('broadcast', { event: 'candidate' }, async (payload) => {
        const { candidate, sessionId, from } = payload.payload;
        if (from !== userId && sessionId === activeSessionId && pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      })
      .on('broadcast', { event: 'reject' }, (payload) => {
        if (payload.payload.sessionId === activeSessionId) {
          cleanup('rejected');
        }
      })
      .on('broadcast', { event: 'hangup' }, (payload) => {
        if (payload.payload.sessionId === activeSessionId) cleanup('ended');
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      clearCallTimeout();
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, activeSessionId, handleOffer, cleanup, setCall, isVideo, clearCallTimeout]);

  return {
    callState,
    isIncoming,
    callerId,
    remoteStream,
    localStream,
    initiateCall,
    acceptCall,
    rejectCall,
    toggleMute,
    endCall,
  };
}
