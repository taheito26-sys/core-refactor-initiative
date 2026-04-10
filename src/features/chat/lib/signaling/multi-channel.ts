// ─── MultiSignalingChannel ────────────────────────────────────────────────────
//
// Orchestrates multiple SignalingChannels simultaneously.
//
// Publish strategy → BROADCAST to all available channels.
//   A message that reaches either Supabase OR the WS relay is a success.
//   allSettled() ensures one failure never aborts delivery through others.
//
// Subscribe strategy → RACE with deduplication.
//   Both channels subscribe; first delivery fires the handler.
//   Duplicate events (same callId from two channels within milliseconds)
//   are suppressed via a seenKeys Set.
//
// Fallback strategy → channels are probed with isAvailable() at call setup.
//   If Supabase is blocked, only the WS channel is used for publish.
//   If both are reachable, both carry every signaling message redundantly.
//
// Architecture inspiration:
//   c-toxcore: connect to all DHT bootstrap nodes in parallel, use first reply
//   RetroShare F2F: peers who share identity can signal directly
//   pion/webrtc: transport-agnostic — swap the pipe, keep the SDP logic
//   Hysteria2: server-side transport (see websocket-channel.ts comments)
// ─────────────────────────────────────────────────────────────────────────────

import { SupabaseSignalingChannel } from './supabase-channel';
import { WebSocketSignalingChannel } from './websocket-channel';
import type { SignalingChannel, SignalingHandlers } from './types';

export class MultiSignalingChannel implements SignalingChannel {
  readonly name = 'multi';

  private readonly channels: SignalingChannel[];
  private availableChannels: SignalingChannel[] = [];
  private wsChannel: WebSocketSignalingChannel | null = null;
  private unsubFns: Array<() => void> = [];
  private seenKeys = new Set<string>();

  private constructor(channels: SignalingChannel[]) {
    this.channels = channels;
    this.wsChannel = channels.find(
      (c): c is WebSocketSignalingChannel =>
        c instanceof WebSocketSignalingChannel,
    ) ?? null;
  }

  // ── Static factory — reads env vars; no args needed at call sites ────────
  static create(): MultiSignalingChannel {
    const relayUrls = (import.meta.env.VITE_SIGNAL_RELAY_URLS as string | undefined ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    const channels: SignalingChannel[] = [
      new SupabaseSignalingChannel(),
      ...(relayUrls.length > 0 ? [new WebSocketSignalingChannel(relayUrls)] : []),
    ];

    return new MultiSignalingChannel(channels);
  }

  /** Pass an auth token to the WebSocket channel for authenticated connections. */
  setAuthToken(token: string | null): void {
    this.wsChannel?.setAuthToken(token ?? null);
  }

  // ── isAvailable ─────────────────────────────────────────────────────────
  // Probes all channels in parallel; populates availableChannels for routing.
  async isAvailable(): Promise<boolean> {
    const results = await Promise.allSettled(
      this.channels.map((ch) => ch.isAvailable()),
    );
    this.availableChannels = this.channels.filter(
      (_, i) =>
        results[i].status === 'fulfilled' &&
        (results[i] as PromiseFulfilledResult<boolean>).value === true,
    );
    return this.availableChannels.length > 0;
  }

  // ── initiateCall ─────────────────────────────────────────────────────────
  // Supabase is the authoritative channel for callId generation (DB insert).
  // After receiving the callId, propagate it to the WS channel so it can
  // filter incoming messages correctly.
  async initiateCall(roomId: string): Promise<string> {
    const supabase = this.channels.find((c) => c.name === 'supabase');
    if (!supabase) throw new Error('MultiSignalingChannel: no Supabase channel');
    const callId = await supabase.initiateCall(roomId);
    this.wsChannel?.updateCallId(callId);
    return callId;
  }

  // ── broadcast publish helpers ────────────────────────────────────────────
  async publishOffer(callId: string, roomId: string, sdp: string, initiatorId: string): Promise<void> {
    await this.broadcast((ch) => ch.publishOffer(callId, roomId, sdp, initiatorId));
  }

  async publishAnswer(callId: string, sdp: string): Promise<void> {
    await this.broadcast((ch) => ch.publishAnswer(callId, sdp));
  }

  async publishIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void> {
    await this.broadcast((ch) => ch.publishIceCandidate(callId, candidate));
  }

  async publishCallEnd(callId: string, reason: string): Promise<void> {
    await this.broadcast((ch) => ch.publishCallEnd(callId, reason));
  }

  // ── subscribe ────────────────────────────────────────────────────────────
  subscribe(
    callId: string | null,
    roomId: string,
    userId: string,
    handlers: SignalingHandlers,
  ): () => void {
    this.seenKeys.clear();

    const deduped: SignalingHandlers = {
      onIncomingCall: (cid, sdpOffer, initiatedBy) => {
        const key = `incoming:${cid}`;
        if (this.seenKeys.has(key)) return;
        this.seenKeys.add(key);
        handlers.onIncomingCall(cid, sdpOffer, initiatedBy);
      },

      // SDP answers are idempotent once RTCPeerConnection.signalingState is
      // checked by the caller; pass through without deduplication.
      onAnswer: (sdp) => handlers.onAnswer(sdp),

      // ICE candidates are fine to arrive multiple times; RTCPeerConnection
      // deduplicates them internally.
      onIceCandidate: (c) => handlers.onIceCandidate(c),

      onCallEnd: (reason) => {
        const key = `end:${reason}`;
        if (this.seenKeys.has(key)) return;
        this.seenKeys.add(key);
        handlers.onCallEnd(reason);
      },
    };

    this.unsubFns = this.channels.map((ch) =>
      ch.subscribe(callId, roomId, userId, deduped),
    );

    return () => {
      this.unsubFns.forEach((fn) => fn());
      this.unsubFns = [];
      this.seenKeys.clear();
    };
  }

  // ── internal broadcast ───────────────────────────────────────────────────
  private async broadcast(fn: (ch: SignalingChannel) => Promise<void>): Promise<void> {
    // Use availableChannels if populated; fall back to all channels if
    // isAvailable() has not been called yet (e.g. outbound-only path).
    const targets = this.availableChannels.length > 0
      ? this.availableChannels
      : this.channels;

    // allSettled: one channel failing never blocks delivery through others
    await Promise.allSettled(targets.map(fn));
  }
}
