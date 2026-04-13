import { beforeEach, describe, expect, it, vi } from 'vitest';

const signalingMocks = vi.hoisted(() => {
  const supabaseInstances: unknown[] = [];
  const websocketInstances: unknown[] = [];

  class MockSupabaseChannel {
    readonly name = 'supabase';
    subscribe = vi.fn(() => vi.fn());
    isAvailable = vi.fn(async () => true);
    initiateCall = vi.fn(async () => 'call-1');
    publishOffer = vi.fn(async () => {});
    publishAnswer = vi.fn(async () => {});
    publishIceCandidate = vi.fn(async () => {});
    publishCallEnd = vi.fn(async () => {});

    constructor() {
      supabaseInstances.push(this);
    }
  }

  class MockWebSocketChannel {
    readonly name = 'websocket';
    readonly relayUrls: string[];
    subscribe = vi.fn(() => vi.fn());
    isAvailable = vi.fn(async () => true);
    initiateCall = vi.fn(async () => {
      throw new Error('not used');
    });
    publishOffer = vi.fn(async () => {});
    publishAnswer = vi.fn(async () => {});
    publishIceCandidate = vi.fn(async () => {});
    publishCallEnd = vi.fn(async () => {});
    setAuthToken = vi.fn();
    updateCallId = vi.fn();

    constructor(relayUrls: string[]) {
      this.relayUrls = relayUrls;
      websocketInstances.push(this);
    }

    matchesRelayUrls(relayUrls: string[]): boolean {
      return this.relayUrls.length === relayUrls.length
        && this.relayUrls.every((url, index) => url === relayUrls[index]);
    }
  }

  return {
    supabaseInstances,
    websocketInstances,
    MockSupabaseChannel,
    MockWebSocketChannel,
  };
});

vi.mock('@/features/chat/lib/signaling/supabase-channel', () => ({
  SupabaseSignalingChannel: signalingMocks.MockSupabaseChannel,
}));

vi.mock('@/features/chat/lib/signaling/websocket-channel', () => ({
  WebSocketSignalingChannel: signalingMocks.MockWebSocketChannel,
}));

import { MultiSignalingChannel } from '@/features/chat/lib/signaling/multi-channel';

describe('MultiSignalingChannel', () => {
  beforeEach(() => {
    signalingMocks.supabaseInstances.length = 0;
    signalingMocks.websocketInstances.length = 0;
    vi.clearAllMocks();
  });

  it('mounts and subscribes a relay channel from call-session signaling_url', () => {
    const channel = MultiSignalingChannel.create();
    const handlers = {
      onIncomingCall: vi.fn(),
      onAnswer: vi.fn(),
      onIceCandidate: vi.fn(),
      onCallEnd: vi.fn(),
    };

    const unsubscribe = channel.subscribe(null, 'room-1', 'user-1', handlers);

    channel.setAuthToken('relay-token');
    channel.setRelayUrls(['wss://relay.example.com/ws']);

    expect(signalingMocks.supabaseInstances).toHaveLength(1);
    expect(signalingMocks.websocketInstances.length).toBeGreaterThanOrEqual(1);
    const relayChannel = (signalingMocks.websocketInstances as Array<{
      relayUrls: string[];
      setAuthToken: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    }>).at(-1)!;
    expect(relayChannel.relayUrls).toEqual(['wss://relay.example.com/ws']);
    expect(relayChannel.setAuthToken).toHaveBeenCalledWith('relay-token');
    expect(relayChannel.subscribe).toHaveBeenCalledWith(null, 'room-1', 'user-1', expect.any(Object));

    unsubscribe();
  });
});
