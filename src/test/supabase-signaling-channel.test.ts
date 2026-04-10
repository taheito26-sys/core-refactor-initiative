import { beforeEach, describe, expect, it, vi } from 'vitest';

const channelCallbacks: Array<(payload: { new: Record<string, unknown> }) => void> = [];
const removeChannel = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    channel: vi.fn(() => {
      const channelObj = {
        on: vi.fn((_event, _filter, callback) => {
          channelCallbacks.push(callback);
          return channelObj;
        }),
        subscribe: vi.fn(() => channelObj),
      };
      return channelObj;
    }),
    removeChannel,
  },
}));

vi.mock('@/features/chat/api/chat', () => ({
  initiateCall: vi.fn(),
  answerCall: vi.fn(),
  endCall: vi.fn(),
  pushIceCandidate: vi.fn(),
  getActiveCall: vi.fn().mockResolvedValue(null),
}));

describe('SupabaseSignalingChannel', () => {
  beforeEach(() => {
    channelCallbacks.length = 0;
    removeChannel.mockReset();
  });

  it('applies remote ICE from the current user participant row and still processes remote offer/answer rows', async () => {
    const { SupabaseSignalingChannel } = await import('@/features/chat/lib/signaling/supabase-channel');
    const handlers = {
      onIncomingCall: vi.fn(),
      onAnswer: vi.fn(),
      onIceCandidate: vi.fn(),
      onCallEnd: vi.fn(),
    };

    const channel = new SupabaseSignalingChannel();
    const unsubscribe = channel.subscribe(null, 'room-1', 'me', handlers);

    expect(channelCallbacks).toHaveLength(2);

    channelCallbacks[1]({
      new: {
        id: 'self-row',
        call_id: 'call-1',
        user_id: 'me',
        ice_candidates: [{ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }],
      },
    });

    channelCallbacks[1]({
      new: {
        id: 'remote-row',
        call_id: 'call-1',
        user_id: 'other',
        sdp_offer: 'offer-sdp',
        sdp_answer: 'answer-sdp',
        ice_candidates: [],
      },
    });

    expect(handlers.onIceCandidate).toHaveBeenCalledWith({
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    expect(handlers.onIncomingCall).toHaveBeenCalledWith('call-1', 'offer-sdp', 'other');
    expect(handlers.onAnswer).toHaveBeenCalledWith('answer-sdp');

    unsubscribe();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });
});
