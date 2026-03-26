import { supabase } from '@/integrations/supabase/client';

export interface SignalingCallbacks {
  onOffer: (offer: RTCSessionDescriptionInit) => Promise<void> | void;
  onAnswer: (answer: RTCSessionDescriptionInit) => Promise<void> | void;
  onCandidate: (candidate: RTCIceCandidateInit) => Promise<void> | void;
  onEnd: () => void;
}

export function createSignaling(callSessionId: string, roomId: string, callbacks: SignalingCallbacks) {
  const channel = supabase.channel(`call:${callSessionId}`);

  const subscribe = () => {
    channel
      .on('broadcast', { event: 'offer' }, (payload) => callbacks.onOffer(payload.payload.offer))
      .on('broadcast', { event: 'answer' }, (payload) => callbacks.onAnswer(payload.payload.answer))
      .on('broadcast', { event: 'candidate' }, (payload) => callbacks.onCandidate(payload.payload.candidate))
      .on('broadcast', { event: 'end' }, () => callbacks.onEnd())
      .subscribe();
  };

  const unsubscribe = () => {
    supabase.removeChannel(channel);
  };

  const sendOffer = async (offer: RTCSessionDescriptionInit) => {
    await channel.send({ type: 'broadcast', event: 'offer', payload: { callSessionId, roomId, offer } });
  };

  const sendAnswer = async (answer: RTCSessionDescriptionInit) => {
    await channel.send({ type: 'broadcast', event: 'answer', payload: { callSessionId, roomId, answer } });
  };

  const sendCandidate = async (candidate: RTCIceCandidateInit) => {
    await channel.send({ type: 'broadcast', event: 'candidate', payload: { callSessionId, roomId, candidate } });
  };

  const sendEnd = async () => {
    await channel.send({ type: 'broadcast', event: 'end', payload: { callSessionId, roomId } });
  };

  return { subscribe, unsubscribe, sendOffer, sendAnswer, sendCandidate, sendEnd };
}
