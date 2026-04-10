import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signalingMock = {
  setAuthToken: vi.fn(),
  isAvailable: vi.fn().mockResolvedValue(true),
  initiateCall: vi.fn().mockResolvedValue('call-started'),
  publishOffer: vi.fn(),
  publishAnswer: vi.fn().mockResolvedValue(undefined),
  publishIceCandidate: vi.fn(),
  publishCallEnd: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
};

const storeState = {
  activeCallId: null as string | null,
  setActiveCallId: vi.fn((id: string | null) => {
    storeState.activeCallId = id;
  }),
  setIncomingCall: vi.fn(),
};

const fromBuilder = {
  select: vi.fn(() => fromBuilder),
  eq: vi.fn(() => fromBuilder),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn(() => fromBuilder),
};

const supabaseMock = {
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
  from: vi.fn(() => fromBuilder),
  functions: {
    invoke: vi.fn(),
  },
};

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ userId: 'me' }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: supabaseMock,
}));

vi.mock('@/lib/chat-store', () => {
  const useChatStore = (selector: (state: typeof storeState) => unknown) => selector(storeState);
  useChatStore.getState = () => storeState;
  return { useChatStore };
});

vi.mock('@/features/chat/lib/signaling/multi-channel', () => ({
  MultiSignalingChannel: {
    create: () => signalingMock,
  },
}));

vi.mock('@/features/chat/lib/signaling/config', () => ({
  getSignalingConfig: () => ({
    useCallSession: false,
    staticRelayUrls: [],
    supabaseFallbackEnabled: true,
  }),
}));

class FakeRTCPeerConnection {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  private readonly senders: RTCRtpSender[] = [];

  addTrack(track: MediaStreamTrack) {
    const sender = {
      track,
      replaceTrack: vi.fn(async (nextTrack: MediaStreamTrack | null) => {
        sender.track = nextTrack;
      }),
    } as unknown as RTCRtpSender & { track: MediaStreamTrack | null };
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  getSenders() {
    return this.senders;
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'fake-answer' } as RTCSessionDescriptionInit;
  }

  async createOffer(options?: RTCOfferOptions) {
    return {
      type: 'offer',
      sdp: options?.offerToReceiveVideo
        ? 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'
        : 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.signalingState = description.type === 'answer' ? 'stable' : 'have-local-offer';
  }

  async setRemoteDescription() {
    this.signalingState = 'have-remote-offer';
  }

  async getStats() {
    return new Map();
  }

  restartIce() {}
  close() {}
}

function createStream(includeVideo: boolean): MediaStream {
  const tracks = [
    {
      kind: 'audio',
      enabled: true,
      stop: vi.fn(),
    } as unknown as MediaStreamTrack,
  ];

  if (includeVideo) {
    tracks.push({
      kind: 'video',
      enabled: true,
      stop: vi.fn(),
    } as unknown as MediaStreamTrack);
  }

  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    addTrack: vi.fn((track: MediaStreamTrack) => {
      tracks.push(track);
    }),
    removeTrack: vi.fn((track: MediaStreamTrack) => {
      const index = tracks.indexOf(track);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
    }),
  } as unknown as MediaStream;
}

describe('useWebRTC answerIncoming', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    storeState.activeCallId = null;
    Object.assign(import.meta.env, {
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
      VITE_SUPABASE_PROJECT_ID: 'project-id',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(),
    });
    (globalThis as unknown as { RTCPeerConnection: typeof RTCPeerConnection }).RTCPeerConnection =
      FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn((constraints: MediaStreamConstraints) =>
          Promise.resolve(createStream(Boolean(constraints.video)))),
      },
    });
  });

  it('answers a video offer with camera media enabled', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall(
        'call-1',
        'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
        'other-user',
      );
    });

    await act(async () => {
      await result.current.answerIncoming();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: true,
        video: expect.any(Object),
      }),
    );
    expect(signalingMock.publishAnswer).toHaveBeenCalledWith('call-1', 'fake-answer');
  });

  it('deduplicates repeated incoming events for the same call id', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-dup', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
      handlers?.onIncomingCall(
        'call-dup',
        'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
        'other-user',
      );
    });

    expect(storeState.setIncomingCall).toHaveBeenCalledTimes(1);
    expect(storeState.setIncomingCall).toHaveBeenCalledWith('call-dup', 'room-1');
    expect(result.current.callState).toBe('ringing');
    expect(result.current.incomingCall?.id).toBe('call-dup');
  });

  it('ends the call cleanly when camera permission is denied during video answer', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const deniedError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(deniedError),
      },
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall(
        'call-2',
        'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
        'other-user',
      );
    });

    await act(async () => {
      await result.current.answerIncoming();
    });

    expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-2', 'failed');
    expect(result.current.callState).toBe('failed');
    expect(result.current.endReason).toBe('camera_permission_denied');
  });

  it('fails cleanly when microphone permission is denied during outgoing call start', async () => {
    const deniedError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(deniedError),
      },
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    expect(signalingMock.publishCallEnd).not.toHaveBeenCalled();
    expect(result.current.callState).toBe('failed');
    expect(result.current.endReason).toBe('microphone_permission_denied');
    expect(result.current.localStream).toBeNull();
    expect(storeState.activeCallId).toBeNull();
  });

  it('declines an incoming call and clears ringing state', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-decline', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
    });

    await act(async () => {
      await result.current.declineIncoming();
    });

    expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-decline', 'declined');
    expect(result.current.callState).toBe('declined');
    expect(result.current.endReason).toBe('declined');
    expect(result.current.incomingCall).toBeNull();
    expect(storeState.setIncomingCall).toHaveBeenLastCalledWith(null, null);
  });

  it('toggles mute by disabling and re-enabling the local audio track', async () => {
    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    const [audioTrack] = result.current.localStream?.getAudioTracks() ?? [];
    expect(audioTrack?.enabled).toBe(true);

    act(() => {
      result.current.toggleMute();
    });

    expect(audioTrack?.enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);

    act(() => {
      result.current.toggleMute();
    });

    expect(audioTrack?.enabled).toBe(true);
    expect(result.current.isMuted).toBe(false);
  });

  it('toggles video by adding and removing the camera track on the existing stream', async () => {
    const getUserMediaMock = vi.fn((constraints: MediaStreamConstraints) =>
      Promise.resolve(createStream(Boolean(constraints.video))));
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    expect(result.current.localStream?.getVideoTracks()).toHaveLength(0);

    await act(async () => {
      await result.current.toggleVideo();
    });

    expect(getUserMediaMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.any(Object),
      }),
    );
    expect(result.current.localStream?.getVideoTracks()).toHaveLength(1);
    expect(result.current.isVideoEnabled).toBe(true);

    await act(async () => {
      await result.current.toggleVideo();
    });

    expect(result.current.localStream?.getVideoTracks()).toHaveLength(0);
    expect(result.current.isVideoEnabled).toBe(false);
  });

  it('publishes call end and tears down local media on hangup', async () => {
    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    const localTracks = result.current.localStream?.getTracks() ?? [];
    const stopSpies = localTracks.map((track) => vi.spyOn(track, 'stop'));

    await act(async () => {
      await result.current.hangUp();
    });

    expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-started', 'ended');
    for (const stopSpy of stopSpies) {
      expect(stopSpy).toHaveBeenCalled();
    }
    expect(result.current.localStream).toBeNull();
    expect(result.current.callState).toBe('ended');
  });

  it('marks an active call as remotely declined when the other side declines', async () => {
    let handlers: {
      onCallEnd: (reason: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    act(() => {
      handlers?.onCallEnd('declined');
    });

    expect(result.current.callState).toBe('declined');
    expect(result.current.endReason).toBe('remote_declined');
    expect(result.current.localStream).toBeNull();
  });

  it('marks a ringing call as missed when the caller cancels before answer', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
      onCallEnd: (reason: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-ringing', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
    });

    act(() => {
      handlers?.onCallEnd('ended');
    });

    expect(result.current.callState).toBe('missed');
    expect(result.current.endReason).toBe('caller_cancelled');
    expect(result.current.incomingCall).toBeNull();
    expect(storeState.setIncomingCall).toHaveBeenLastCalledWith(null, null);
  });

  it('publishes a navigated-away end event when the hook unmounts during an active call', async () => {
    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result, unmount } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    unmount();

    await waitFor(() => {
      expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-started', 'navigated_away');
    });
  });

  it('reports tab_closed through the beforeunload handler for an active call', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/rpc/chat_end_call'),
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({ _call_id: 'call-started', _end_reason: 'tab_closed' }),
      }),
    );
  });

  it('auto-declines an unanswered incoming call when the hook unmounts', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result, unmount } = renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-unmount-ringing', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
    });

    unmount();

    await waitFor(() => {
      expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-unmount-ringing', 'declined');
    });
    expect(storeState.setIncomingCall).toHaveBeenLastCalledWith(null, null);
  });

  it('reports declined through the beforeunload handler for an unanswered incoming call', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    renderHook(() => useWebRTC('room-1'));

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-beforeunload-ringing', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
    });

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/rpc/chat_end_call'),
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({ _call_id: 'call-beforeunload-ringing', _end_reason: 'declined' }),
      }),
    );
  });

  it('transitions to ended when the remote side ends an active call', async () => {
    let handlers: {
      onCallEnd: (reason: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result } = renderHook(() => useWebRTC('room-1'));

    await act(async () => {
      await result.current.startCall(false);
    });

    act(() => {
      handlers?.onCallEnd('ended');
    });

    expect(result.current.callState).toBe('ended');
    expect(result.current.endReason).toBe('remote_ended');
    expect(result.current.localStream).toBeNull();
  });

  it('marks an unanswered outgoing call as missed after the ring timeout', async () => {
    vi.useFakeTimers();
    try {
      const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
      const { result } = renderHook(() => useWebRTC('room-1'));

      await act(async () => {
        await result.current.startCall(false);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });

      expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-started', 'no_answer');
      expect(result.current.callState).toBe('missed');
      expect(result.current.endReason).toBe('no_answer');
      expect(result.current.localStream).toBeNull();
      expect(storeState.activeCallId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes a room-changed end event and resets call state when the room id changes', async () => {
    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result, rerender } = renderHook(({ roomId }) => useWebRTC(roomId), {
      initialProps: { roomId: 'room-1' },
    });

    await act(async () => {
      await result.current.startCall(false);
    });

    rerender({ roomId: 'room-2' });

    await waitFor(() => {
      expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-started', 'room_changed');
    });
    expect(result.current.callState).toBe('idle');
    expect(result.current.endReason).toBeNull();
    expect(result.current.localStream).toBeNull();
    expect(storeState.activeCallId).toBeNull();
  });

  it('auto-declines an unanswered incoming call when the room id changes', async () => {
    let handlers: {
      onIncomingCall: (callId: string, sdpOffer: string, initiatedBy: string) => void;
    } | null = null;
    signalingMock.subscribe.mockImplementation((_callId, _roomId, _userId, nextHandlers) => {
      handlers = nextHandlers;
      return () => {};
    });

    const { useWebRTC } = await import('@/features/chat/hooks/useWebRTC');
    const { result, rerender } = renderHook(({ roomId }) => useWebRTC(roomId), {
      initialProps: { roomId: 'room-1' },
    });

    await waitFor(() => expect(handlers).not.toBeNull());

    act(() => {
      handlers?.onIncomingCall('call-room-ringing', 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', 'other-user');
    });

    rerender({ roomId: 'room-2' });

    await waitFor(() => {
      expect(signalingMock.publishCallEnd).toHaveBeenCalledWith('call-room-ringing', 'declined');
    });
    expect(result.current.callState).toBe('idle');
    expect(result.current.endReason).toBeNull();
    expect(result.current.incomingCall).toBeNull();
    expect(storeState.setIncomingCall).toHaveBeenLastCalledWith(null, null);
  });
});
