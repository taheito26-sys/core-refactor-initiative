import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallOverlay } from '@/features/chat/components/CallOverlay';
import type { UseWebRTCReturn } from '@/features/chat/hooks/useWebRTC';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

function createTrack(kind: 'audio' | 'video'): MediaStreamTrack {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createWebrtc(partial: Partial<UseWebRTCReturn>): UseWebRTCReturn {
  return {
    callState: 'idle',
    localStream: null,
    remoteStream: null,
    activeCallId: null,
    incomingCall: null,
    startCall: vi.fn(),
    answerIncoming: vi.fn(),
    declineIncoming: vi.fn(),
    hangUp: vi.fn(),
    toggleMute: vi.fn(),
    toggleVideo: vi.fn(),
    toggleScreenShare: vi.fn(),
    isMuted: false,
    isVideoEnabled: false,
    isVideoCall: false,
    isScreenSharing: false,
    callDuration: 0,
    endReason: null,
    qualityStats: null,
    remoteStreams: new Map(),
    participantCount: 0,
    ...partial,
  };
}

describe('CallOverlay', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('attaches the remote stream to a hidden audio element for audio-only calls', async () => {
    const remoteStream = new FakeMediaStream([createTrack('audio')]) as unknown as MediaStream;
    const webrtc = createWebrtc({
      callState: 'connected',
      remoteStream,
    });

    const { container } = render(<CallOverlay webrtc={webrtc} />);
    const audio = container.querySelector('audio') as HTMLAudioElement | null;

    expect(audio).not.toBeNull();

    await waitFor(() => {
      expect(audio?.srcObject).toBe(remoteStream);
    });
  });

  it('renders the video layout when the remote stream contains a video track', () => {
    const remoteStream = new FakeMediaStream([
      createTrack('audio'),
      createTrack('video'),
    ]) as unknown as MediaStream;

    const webrtc = createWebrtc({
      callState: 'connected',
      remoteStream,
    });

    const { container } = render(<CallOverlay webrtc={webrtc} />);

    expect(container.querySelector('video')).not.toBeNull();
  });
});
