// ─── Signaling Abstraction ────────────────────────────────────────────────────
//
// Transport-agnostic interface for WebRTC call signaling.
//
// Inspired by:
//   - pion/webrtc: custom signaling over any transport (WS, HTTP, QUIC)
//   - c-toxcore DHT: multiple bootstrap nodes in parallel, first response wins
//   - RetroShare F2F: peers identified by keys, direct channel when possible
//   - Hysteria2: QUIC/HTTP3-masqueraded transport, server-side relay option
//
// The media path (DTLS-SRTP) is already E2E encrypted by WebRTC.
// Only the signaling envelope needs to be censorship-resistant.
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalingHandlers {
  /** Callee side: an offer arrived, call is ringing */
  onIncomingCall(callId: string, sdpOffer: string, initiatedBy: string): void;
  /** Caller side: remote peer accepted, SDP answer arrived */
  onAnswer(sdpAnswer: string): void;
  /** Both sides: trickle ICE candidate from remote */
  onIceCandidate(candidate: RTCIceCandidateInit): void;
  /** Both sides: remote ended/declined/failed the call */
  onCallEnd(reason: string): void;
}

export interface SignalingChannel {
  /** Human-readable name for debug logs */
  readonly name: string;

  /**
   * Probe reachability. Must resolve in ≤ 3 s (use AbortController internally).
   * Called once at call-setup time to populate the available-channel list.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Create a call record and return a stable callId.
   * Only the authoritative channel (Supabase) needs a real implementation;
   * others may throw — MultiSignalingChannel handles delegation.
   */
  initiateCall(roomId: string): Promise<string>;

  /** Push our SDP offer to remote peers in the room */
  publishOffer(
    callId: string,
    roomId: string,
    sdp: string,
    initiatorId: string,
  ): Promise<void>;

  /** Push our SDP answer back to the caller */
  publishAnswer(callId: string, sdp: string): Promise<void>;

  /** Push a trickle ICE candidate */
  publishIceCandidate(
    callId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void>;

  /** Notify all peers the call is over */
  publishCallEnd(callId: string, reason: string): Promise<void>;

  /**
   * Subscribe to all signaling events for this (roomId, userId) pair.
   * callId may be null at subscription time (hook subscribes before a call
   * starts so it can receive incoming calls).
   * Returns an unsubscribe function; must be idempotent.
   */
  subscribe(
    callId: string | null,
    roomId: string,
    userId: string,
    handlers: SignalingHandlers,
  ): () => void;
}

// ── Wire protocol for the WebSocket relay ────────────────────────────────────
// Used by WebSocketSignalingChannel and the companion Go relay server.
// JSON-serialised over a plain WebSocket frame.

export type WireMessageType =
  | 'offer'    // SDP offer from caller
  | 'answer'   // SDP answer from callee
  | 'ice'      // trickle ICE candidate
  | 'end'      // call terminated
  | 'ping'     // keepalive from client
  | 'pong';    // keepalive reply from server

export interface WireMessage {
  type: WireMessageType;
  callId?: string;
  roomId?: string;
  /** Sender identity — set server-side from JWT sub to prevent spoofing */
  userId?: string;
  /** For 'offer': who initiated the call */
  initiatorId?: string;
  /**
   * Payload semantics by type:
   *   offer  → string (SDP)
   *   answer → string (SDP)
   *   ice    → RTCIceCandidateInit
   *   end    → { reason: string }
   *   ping/pong → undefined
   */
  payload?: unknown;
  /** Unix ms, stamped server-side for ordering */
  ts?: number;
}
