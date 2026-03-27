import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCallStore } from '@/lib/call-store';

interface Props {
  roomId: string | null;
  userId: string;
}

export function useWebRTC({ roomId, userId }: Props) {
  const { callState, isIncoming, activeSessionId, callerId, isVideo, setCall, resetCall } = useCallStore();
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    resetCall();
  }, [localStream, resetCall]);

  const setupPC = useCallback((sessionId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate && roomId) {
        supabase.channel(`room:${roomId}:calls`).send({
          type: 'broadcast',
          event: 'candidate',
          payload: { candidate: e.candidate, sessionId, from: userId }
        });
      }
    };

    pc.ontrack = (e) => {
      if (e.streams[0]) setRemoteStream(e.streams[0]);
    };

    pcRef.current = pc;
    return pc;
  }, [roomId, userId]);

  const initiateCall = useCallback(async (is_video: boolean) => {
    if (!roomId) return;
    const sessionId = Math.random().toString(36).slice(2);
    setCall('ringing', false, userId, sessionId, is_video);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: is_video });
    setLocalStream(stream);

    const pc = setupPC(sessionId);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    supabase.channel(`room:${roomId}:calls`).send({
      type: 'broadcast',
      event: 'offer',
      payload: { offer, sessionId, from: userId, is_video }
    });
  }, [roomId, userId, setupPC, setCall]);

  const handleOffer = useCallback(async (payload: any) => {
    if (payload.from === userId) return;
    setCall('ringing', true, payload.from, payload.sessionId, payload.is_video);
  }, [userId, setCall]);

  const acceptCall = useCallback(async () => {
    if (!roomId || !activeSessionId) return;
    setCall('connecting', true, null, activeSessionId, isVideo);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
    setLocalStream(stream);

    const pc = setupPC(activeSessionId);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
  }, [roomId, activeSessionId, setupPC, setCall, isVideo]);

  const endCall = useCallback(() => {
    if (roomId && activeSessionId) {
      supabase.channel(`room:${roomId}:calls`).send({
        type: 'broadcast',
        event: 'hangup',
        payload: { sessionId: activeSessionId, from: userId }
      });
    }
    cleanup();
  }, [roomId, activeSessionId, userId, cleanup]);

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`room:${roomId}:calls`);
    channel
      .on('broadcast', { event: 'offer' }, (payload) => handleOffer(payload.payload))
      .on('broadcast', { event: 'answer' }, async (payload) => {
        const { answer, sessionId, from } = payload.payload;
        if (from !== userId && sessionId === activeSessionId && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          setCall('connected', isIncoming || false, from, sessionId, isVideo);
        }
      })
      .on('broadcast', { event: 'candidate' }, async (payload) => {
        const { candidate, sessionId, from } = payload.payload;
        if (from !== userId && sessionId === activeSessionId && pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      })
      .on('broadcast', { event: 'hangup' }, (payload) => {
        if (payload.payload.sessionId === activeSessionId) cleanup();
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [roomId, userId, activeSessionId, handleOffer, cleanup, setCall, isIncoming, isVideo]);

  return { callState, isIncoming, callerId, remoteStream, localStream, initiateCall, acceptCall, endCall };
}
