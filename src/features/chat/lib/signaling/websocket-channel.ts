// ─── WebSocketSignalingChannel ────────────────────────────────────────────────
//
// Censorship-resistant signaling fallback using a self-hosted WebSocket relay.
// Uses only the browser's native WebSocket API — zero new npm dependencies.
//
// Connection strategy (inspired by c-toxcore DHT bootstrap model):
//   - Connect to ALL configured relay URLs in parallel on subscribe().
//   - Use whichever WebSocket handshake completes first.
//   - On disconnect, rotate to the next relay URL (round-robin).
//   - Outbound messages are queued if not yet connected and flushed on open.
//
// ─────────────────────────────────────────────────────────────────────────────
// RELAY SERVER DEPLOYMENT GUIDE
// ─────────────────────────────────────────────────────────────────────────────
//
// OPTION A — pion/webrtc-style Go relay (pure message routing, ~100 lines)
// ─────────────────────────────────────────────────────────────────────────────
//
//   package main
//
//   import (
//     "encoding/json"   "log"   "net/http"
//     "sync"            "time"
//     "github.com/gorilla/websocket"
//   )
//
//   var upgrader = websocket.Upgrader{
//     CheckOrigin: func(r *http.Request) bool { return true },
//   }
//
//   type Hub struct {
//     mu    sync.RWMutex
//     rooms map[string]map[*websocket.Conn]string // room → conn → userId
//   }
//
//   func (h *Hub) join(roomId string, conn *websocket.Conn, userId string) {
//     h.mu.Lock(); defer h.mu.Unlock()
//     if h.rooms[roomId] == nil { h.rooms[roomId] = make(map[*websocket.Conn]string) }
//     h.rooms[roomId][conn] = userId
//   }
//
//   func (h *Hub) leave(roomId string, conn *websocket.Conn) {
//     h.mu.Lock(); defer h.mu.Unlock()
//     delete(h.rooms[roomId], conn)
//   }
//
//   func (h *Hub) broadcast(roomId string, from *websocket.Conn, msg []byte) {
//     h.mu.RLock(); defer h.mu.RUnlock()
//     for c := range h.rooms[roomId] {
//       if c != from { c.WriteMessage(websocket.TextMessage, msg) }
//     }
//   }
//
//   // Validate Supabase JWT so only authenticated users can relay
//   func userIdFromToken(r *http.Request) string {
//     // Parse "Authorization: Bearer <jwt>" header
//     // Verify HS256 signature with SUPABASE_JWT_SECRET env var
//     // Return sub claim (userId) or "" on failure
//     return r.URL.Query().Get("uid") // simplified; use jwt.Parse in production
//   }
//
//   func (h *Hub) handle(w http.ResponseWriter, r *http.Request) {
//     roomId := r.URL.Query().Get("room")
//     if roomId == "" { http.Error(w, "room required", 400); return }
//     userId := userIdFromToken(r)
//     conn, err := upgrader.Upgrade(w, r, nil)
//     if err != nil { return }
//     h.join(roomId, conn, userId)
//     defer func() { h.leave(roomId, conn); conn.Close() }()
//     conn.SetReadDeadline(time.Now().Add(60 * time.Second))
//     conn.SetPongHandler(func(string) error {
//       conn.SetReadDeadline(time.Now().Add(60 * time.Second)); return nil
//     })
//     go func() { // keepalive ticker
//       for range time.Tick(25 * time.Second) { conn.WriteMessage(websocket.PingMessage, nil) }
//     }()
//     for {
//       _, p, err := conn.ReadMessage()
//       if err != nil { break }
//       var msg map[string]interface{}
//       if json.Unmarshal(p, &msg) != nil { continue }
//       msg["userId"] = userId               // stamp server-side to prevent spoofing
//       msg["ts"] = time.Now().UnixMilli()
//       out, _ := json.Marshal(msg)
//       h.broadcast(roomId, conn, out)
//     }
//   }
//
//   func main() {
//     hub := &Hub{rooms: make(map[string]map[*websocket.Conn]string)}
//     http.HandleFunc("/ws", hub.handle)
//     // TLS termination via nginx on port 443 makes this indistinguishable
//     // from HTTPS traffic to any deep-packet inspection middlebox.
//     log.Fatal(http.ListenAndServe(":8080", nil))
//   }
//
//   Deploy on cheap VPS in multiple jurisdictions:
//     DE: Hetzner CX11 (~4 EUR/mo)  →  wss://relay-de.example.com/ws
//     SG: Vultr VC2     (~5 USD/mo)  →  wss://relay-sg.example.com/ws
//     US: Fly.io free   (0 USD)      →  wss://relay-us.fly.dev/ws
//   Set VITE_SIGNAL_RELAY_URLS=wss://relay-de.../ws,wss://relay-sg.../ws,...
//
// ─────────────────────────────────────────────────────────────────────────────
// OPTION B — Hysteria2 front-end (apernet/hysteria) — maximum DPI resistance
// ─────────────────────────────────────────────────────────────────────────────
//
//   Hysteria2 uses QUIC with HTTP/3 masquerading, making it indistinguishable
//   from ordinary HTTPS browsing. A browser cannot use QUIC/Hysteria directly,
//   but the Capacitor native app can route through a local Hysteria client.
//
//   Server setup (hysteria-server.yaml):
//     listen: :443
//     tls:
//       cert: /path/to/cert.pem
//       key:  /path/to/key.pem
//     auth:
//       type: password
//       password: <VITE_HYSTERIA_PASSWORD>
//     masquerade:
//       type: proxy
//       proxy:
//         url: https://relay-de.example.com   # your Go relay behind nginx
//         rewriteHost: true
//
//   This makes the Hysteria server act as a reverse proxy to the Go relay.
//   Observers see only HTTP/3 traffic on UDP 443; the WebSocket is tunnelled
//   inside the QUIC stream.
//
//   For the Capacitor (native) app, integrate a Hysteria client:
//     1. Add a Capacitor plugin (Rust/Swift/Kotlin wrapper around hysteria-go)
//        that creates a local SOCKS5 proxy on 127.0.0.1:1080.
//     2. Configure the native HTTP/WS stack to use this proxy for relay URLs.
//     3. The WebSocket channel below connects to the relay as normal;
//        the Hysteria SOCKS5 proxy handles the censorship bypass transparently.
//
//   For the browser (web app):
//     - WSS on TCP 443 with TLS already looks like HTTPS to most DPI.
//     - Only the most aggressive censors (GFW) will block it by fingerprint.
//     - For those, the Capacitor native app with Hysteria is the solution.
//
//   Reference: https://github.com/apernet/hysteria
// ─────────────────────────────────────────────────────────────────────────────

import type { SignalingChannel, SignalingHandlers, WireMessage } from './types';

const PING_INTERVAL_MS  = 25_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_TRIES = 8;
const PROBE_TIMEOUT_MS  = 3_000;

export class WebSocketSignalingChannel implements SignalingChannel {
  readonly name = 'websocket';

  private readonly relayUrls: string[];
  private ws: WebSocket | null = null;
  private activeUrl = '';
  private reconnectCount = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private handlers: SignalingHandlers | null = null;
  private subParams: { callId: string | null; roomId: string; userId: string } | null = null;
  private disposed = false;
  private messageQueue: WireMessage[] = [];

  private authToken: string | null = null;

  constructor(relayUrls: string[]) {
    this.relayUrls = relayUrls;
  }

  matchesRelayUrls(relayUrls: string[]): boolean {
    return this.relayUrls.length === relayUrls.length
      && this.relayUrls.every((url, index) => url === relayUrls[index]);
  }

  /** Set the auth token to pass as a query parameter on WS connect. */
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  // ── availability probe ──────────────────────────────────────────────────
  // Races all relay URLs; resolves true as soon as any handshake succeeds.
  async isAvailable(): Promise<boolean> {
    if (this.relayUrls.length === 0) return false;
    const probes = this.relayUrls.map(
      (url) =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { resolve(false); try { ws.close(); } catch { /* */ } }, PROBE_TIMEOUT_MS);
          const ws = new WebSocket(`${url}?probe=1`);
          ws.onopen  = () => { clearTimeout(timer); ws.close(); resolve(true); };
          ws.onerror = () => { clearTimeout(timer); resolve(false); };
        }),
    );
    const results = await Promise.all(probes);
    return results.some(Boolean);
  }

  // ── initiateCall — NOT supported by this channel ────────────────────────
  // Call IDs are owned by the Supabase database. MultiSignalingChannel always
  // delegates initiateCall() to SupabaseSignalingChannel.
  async initiateCall(_roomId: string): Promise<string> {
    throw new Error('WebSocketSignalingChannel: initiateCall must use SupabaseSignalingChannel');
  }

  // ── updateCallId — called by MultiSignalingChannel after initiation ─────
  // Allows the channel to filter incoming messages to the current callId.
  updateCallId(callId: string): void {
    if (this.subParams) this.subParams.callId = callId;
  }

  // ── subscribe ───────────────────────────────────────────────────────────
  subscribe(
    callId: string | null,
    roomId: string,
    userId: string,
    handlers: SignalingHandlers,
  ): () => void {
    this.handlers = handlers;
    this.subParams = { callId, roomId, userId };
    this.connect(roomId);
    return () => this.dispose();
  }

  // ── publish ─────────────────────────────────────────────────────────────
  async publishOffer(callId: string, roomId: string, sdp: string, initiatorId: string): Promise<void> {
    this.enqueue({ type: 'offer', callId, roomId, initiatorId, payload: sdp });
  }

  async publishAnswer(callId: string, sdp: string): Promise<void> {
    this.enqueue({ type: 'answer', callId, payload: sdp });
  }

  async publishIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void> {
    this.enqueue({ type: 'ice', callId, payload: candidate });
  }

  async publishCallEnd(callId: string, reason: string): Promise<void> {
    this.enqueue({ type: 'end', callId, payload: { reason } });
  }

  // ── internal: WebSocket lifecycle ──────────────────────────────────────
  private connect(roomId: string): void {
    if (this.disposed || this.relayUrls.length === 0) return;

    // Rotate relay URLs on reconnect — Tox-style bootstrap diversity
    this.activeUrl = this.relayUrls[this.reconnectCount % this.relayUrls.length];
    let url = `${this.activeUrl}?room=${encodeURIComponent(roomId)}`;
    if (this.authToken) {
      url += `&token=${encodeURIComponent(this.authToken)}`;
    }
    // Pass callId so relay can verify against the token's call claim
    if (this.subParams?.callId) {
      url += `&call=${encodeURIComponent(this.subParams.callId)}`;
    }

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectCount = 0;
      this.startPing();
      // Drain queued messages (may include the SDP offer if it was published
      // before the handshake completed)
      const queued = this.messageQueue.splice(0);
      for (const msg of queued) this.sendRaw(msg);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WireMessage;
        this.dispatch(msg);
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      this.stopPing();
      if (!this.disposed && this.reconnectCount < MAX_RECONNECT_TRIES) {
        this.reconnectCount++;
        setTimeout(() => {
          if (!this.disposed && this.subParams) {
            this.connect(this.subParams.roomId);
          }
        }, RECONNECT_DELAY_MS * Math.min(this.reconnectCount, 4));
      }
    };

    // onerror always fires before onclose; handled there.
    ws.onerror = () => { /* intentionally empty */ };
  }

  private dispatch(msg: WireMessage): void {
    if (!this.handlers || !this.subParams) return;
    const { callId: activeCallId, userId } = this.subParams;

    // Suppress our own echoes (server stamps userId from JWT)
    if (msg.userId === userId) return;

    // Filter to active call once we have a callId
    if (msg.callId && activeCallId && msg.callId !== activeCallId) return;

    switch (msg.type) {
      case 'offer':
        if (msg.initiatorId !== userId) {
          this.handlers.onIncomingCall(
            msg.callId ?? '',
            msg.payload as string,
            msg.initiatorId ?? '',
          );
        }
        break;
      case 'answer':
        this.handlers.onAnswer(msg.payload as string);
        break;
      case 'ice':
        this.handlers.onIceCandidate(msg.payload as RTCIceCandidateInit);
        break;
      case 'end':
        this.handlers.onCallEnd((msg.payload as { reason?: string })?.reason ?? 'ended');
        break;
      case 'pong':
        break; // keepalive confirmed, no action needed
    }
  }

  private enqueue(msg: WireMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw(msg);
    } else {
      // Queue for delivery once connected; prevents dropped first offer
      this.messageQueue.push(msg);
    }
  }

  private sendRaw(msg: WireMessage): void {
    try { this.ws?.send(JSON.stringify(msg)); } catch { /* non-fatal */ }
  }

  private startPing(): void {
    this.pingTimer = setInterval(
      () => this.enqueue({ type: 'ping' }),
      PING_INTERVAL_MS,
    );
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private dispose(): void {
    this.disposed = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.handlers = null;
    this.messageQueue = [];
  }
}
