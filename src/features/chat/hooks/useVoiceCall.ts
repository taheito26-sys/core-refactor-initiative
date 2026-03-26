import { useEffect, useMemo, useRef, useState } from 'react';
import { createPeerConnection, ensureMicTrack, stopMediaStream } from '@/features/chat/calls/webrtc';
import { createSignaling, type SignalingCallbacks } from '@/features/chat/calls/signaling';

export function useVoiceCall(callSessionId: string | null, roomId: string | null) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);

  const signaling = useMemo(() => {
    if (!callSessionId || !roomId) return null;
    const callbacks: SignalingCallbacks = {
      onOffer: async (offer) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
      },
      onAnswer: async (answer) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      },
      onCandidate: async (candidate) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      },
      onEnd: () => {
        setConnected(false);
      },
    };
    return createSignaling(callSessionId, roomId, callbacks);
  }, [callSessionId, roomId]);

  useEffect(() => {
    if (!callSessionId || !signaling) return;

    const pc = createPeerConnection({
      onIceCandidate: (candidate) => signaling.sendCandidate(candidate),
      onConnectionStateChange: (state) => {
        setConnected(state === 'connected');
        if (state === 'failed' || state === 'disconnected') setError('Call connection degraded. Reconnecting...');
      },
    });
    pcRef.current = pc;

    let alive = true;
    ensureMicTrack()
      .then((stream) => {
        if (!alive) {
          stopMediaStream(stream);
          return;
        }
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      })
      .catch(() => {
        setError('Microphone permission denied or unavailable.');
      });

    signaling.subscribe();

    return () => {
      alive = false;
      signaling.unsubscribe();
      pc.close();
      pcRef.current = null;
      if (localStreamRef.current) {
        stopMediaStream(localStreamRef.current);
        localStreamRef.current = null;
      }
      setConnected(false);
    };
  }, [callSessionId, signaling]);

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  };

  return {
    connected,
    muted,
    error,
    toggleMute,
  };
}
