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
  private unsubMap = new Map<SignalingChannel, () => void>();
  private seenKeys = new Set<string>();
  private incomingOfferState = new Map<string, boolean>();
  private currentSubscription: {
    callId: string | null;
    roomId: string;
    userId: string;
    handlers: SignalingHandlers;
  } | null = null;
  private wsAuthToken: string | null = null;
  private wsRelayToken: string | null = null;

  private constructor(channels: SignalingChannel[]) {
    this.channels = channels;
    this.wsChannel = channels.find(
      (c): c is WebSocketSignalingChannel =>
        c instanceof WebSocketSignalingChannel,
    ) ?? null;
  }

  // ── Static factory — reads env vars; no args needed at call sites ────────
  static create(): MultiSignalingChannel {
    // WS relay channel is mounted lazily via setRelayUrls() after call-session
    // returns a per-call relay URL + HMAC token. Do NOT read VITE_SIGNAL_RELAY_URLS
    // here — a static relay URL causes the browser to open an unauthenticated
    // WebSocket before the call-session token flow runs, which gets rejected.
    const channels: SignalingChannel[] = [
      new SupabaseSignalingChannel(),
    ];

    return new MultiSignalingChannel(channels);
  }

  /** Pass an auth token to the WebSocket channel for authenticated connections. */
  setAuthToken(token: string | null): void {
    this.wsAuthToken = token ?? null;
    if (!this.wsRelayToken) {
      this.wsChannel?.setAuthToken(token ?? null);
    }
  }

  /**
   * Call-session returns a short-lived HMAC relay token that must take priority
   * over the normal Supabase session token for WebSocket relay auth.
   */
  setRelayAuthToken(token: string | null): void {
    this.wsRelayToken = token ?? null;
    this.wsChannel?.setAuthToken(this.wsRelayToken ?? this.wsAuthToken);
  }

  /**
   * Update the active callId in the current subscription.
   * Must be called after call-session returns a callId so the WS channel
   * connects with the correct callId in the query string (used by the relay
   * to verify the token's call claim and group sockets correctly).
   */
  updateActiveCallId(callId: string): void {
    if (this.currentSubscription) {
      this.currentSubscription.callId = callId;
    }
    // Propagate to the WS channel so it filters incoming messages correctly
    this.wsChannel?.updateCallId(callId);
  }

  /**
   * The edge function can return a per-call signaling relay URL.
   * If the app wasn't booted with static relay URLs, mount the WS channel lazily.
   */
  setRelayUrls(relayUrls: string[]): void {
    const normalizedRelayUrls = relayUrls
      .map((url) => url.trim())
      .filter(Boolean);

    if (normalizedRelayUrls.length === 0) return;

    if (this.wsChannel?.matchesRelayUrls(normalizedRelayUrls)) {
      return;
    }

    if (this.wsChannel) {
      this.unsubMap.get(this.wsChannel)?.();
      this.unsubMap.delete(this.wsChannel);
      this.availableChannels = this.availableChannels.filter((channel) => channel !== this.wsChannel);
      const wsIndex = this.channels.indexOf(this.wsChannel);
      if (wsIndex >= 0) {
        this.channels.splice(wsIndex, 1);
      }
    }

    const wsChannel = new WebSocketSignalingChannel(normalizedRelayUrls);
    wsChannel.setAuthToken(this.wsRelayToken ?? this.wsAuthToken);
    this.wsChannel = wsChannel;
    this.channels.push(wsChannel);
    this.availableChannels = Array.from(new Set([...this.availableChannels, wsChannel]));

    if (this.currentSubscription) {
      this.unsubMap.set(
        wsChannel,
        wsChannel.subscribe(
          this.currentSubscription.callId,
          this.currentSubscription.roomId,
          this.currentSubscription.userId,
          this.currentSubscription.handlers,
        ),
      );
    }
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
    this.incomingOfferState.clear();

    const deduped: SignalingHandlers = {
      onIncomingCall: (cid, sdpOffer, initiatedBy) => {
        const key = `incoming:${cid}`;
        const hadOffer = this.incomingOfferState.get(cid) ?? false;
        const hasOfferNow = Boolean(sdpOffer);

        if (this.seenKeys.has(key) && (!hasOfferNow || hadOffer)) return;

        this.seenKeys.add(key);
        this.incomingOfferState.set(cid, hadOffer || hasOfferNow);
        handlers.onIncomingCall(cid, sdpOffer, initiatedBy);
      },

      // SDP answers are idempotent once RTCPeerConnection.signalingState is
      // checked by the caller; pass through without deduplication.
      onAnswer: (sdp) => handlers.onAnswer(sdp),

      // Deduplicate ICE candidates — Chrome does NOT deduplicate addIceCandidate
      // calls internally. Duplicate candidates trigger redundant ICE checks
      // which cause connected→disconnected→connected flapping.
      onIceCandidate: (c) => {
        const key = `ice:${(c as RTCIceCandidateInit).candidate ?? JSON.stringify(c)}`;
        if (this.seenKeys.has(key)) return;
        this.seenKeys.add(key);
        handlers.onIceCandidate(c);
      },

      onCallEnd: (reason) => {
        const key = `end:${reason}`;
        if (this.seenKeys.has(key)) return;
        this.seenKeys.add(key);
        // Clear ICE dedup set so the next call gets fresh candidates
        // (keep only the end key itself to prevent duplicate end events)
        const endKey = key;
        this.seenKeys.clear();
        this.seenKeys.add(endKey);
        handlers.onCallEnd(reason);
      },
    };

    this.currentSubscription = { callId, roomId, userId, handlers: deduped };
    this.unsubMap.forEach((unsubscribe) => unsubscribe());
    this.unsubMap.clear();
    this.channels.forEach((channel) => {
      this.unsubMap.set(
        channel,
        channel.subscribe(callId, roomId, userId, deduped),
      );
    });

    return () => {
      this.unsubMap.forEach((unsubscribe) => unsubscribe());
      this.unsubMap.clear();
      this.currentSubscription = null;
      this.seenKeys.clear();
      this.incomingOfferState.clear();
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
