import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCallStore } from '@/lib/call-store';
import { toast } from 'sonner';

interface Props {
  roomId: string | null;
  userId: string;
  onTimelineEvent?: (eventType: string) => void;
}

const CALL_TIMEOUT_MS = 30_000;

export function useWebRTC({ roomId, userId, onTimelineEvent }: Props) {
  const { callState, isIncoming, activeSessionId, callerId, isVideo, setCall, resetCall } = useCallStore();
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback((reason: string = 'ended') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    if (reason !== 'silent') onTimelineEvent?.(reason);
    resetCall();
  }, [localStream, resetCall, onTimelineEvent]);

  const setupPC = useCallback((sessionId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate && roomId) {
        channelRef.current?.send({
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
      if (pc.connectionState === 'connected') setCall('connected', isIncoming, callerId, sessionId, isVideo);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') cleanup('call_failed');
    };

    pcRef.current = pc;
    return pc;
  }, [roomId, userId, setCall, isIncoming, callerId, isVideo, cleanup]);

  const initiateCall = useCallback(async (is_video: boolean) => {
    if (!roomId) return;
    try {
      const sessionId = Math.random().toString(36).slice(2);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: is_video });
      setLocalStream(stream);
      setCall('ringing', false, userId, sessionId, is_video);
      
      const pc = setupPC(sessionId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      channelRef.current?.send({
        type: 'broadcast',
        event: 'offer',
        payload: { offer, sessionId, from: userId, is_video },
      });

      timeoutRef.current = setTimeout(() => cleanup('call_missed'), CALL_TIMEOUT_MS);
    } catch (err) {
      toast.error("Microphone/Camera access denied");
    }
  }, [roomId, userId, setupPC, setCall, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!activeSessionId || !pcRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      setLocalStream(stream);
      stream.getTracks().forEach((t) => pcRef.current?.addTrack(t, stream));
      
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      channelRef.current?.send({
        type: 'broadcast',
        event: 'answer',
        payload: { answer, sessionId: activeSessionId, from: userId },
      });
    } catch (err) {
      cleanup('call_failed');
    }
  }, [activeSessionId, isVideo, userId, cleanup]);

  const toggleMute = useCallback((muted: boolean) => {
    localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
  }, [localStream]);

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`room:${roomId}:calls`);
    
    channel
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.from === userId) return;
        setCall('ringing', true, payload.from, payload.sessionId, payload.is_video);
        const pc = setupPC(payload.sessionId);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.from !== userId && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        }
      })
      .on('broadcast', { event: 'candidate' }, async ({ payload }) => {
        if (payload.from !== userId && pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      })
      .on('broadcast', { event: 'hangup' }, () => cleanup('call_ended'))
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [roomId, userId, setupPC, setCall, cleanup]);

  return { callState, isIncoming, callerId, remoteStream, initiateCall, acceptCall, endCall: () => cleanup('call_ended'), toggleMute };
}