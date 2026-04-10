// ─── Signaling Relay Edge Function ────────────────────────────────────────────
//
// A lightweight WebSocket signaling relay for WebRTC call negotiation.
// Participants connect via wss://, authenticate with an HMAC token
// (issued by call-session), and exchange SDP offers/answers + ICE candidates
// in real time — without depending on Supabase Realtime / CDC.
//
// Protocol:
//   1. Client connects: wss://<host>/signaling-relay?token=<jwt>&call=<callId>
//   2. Server validates HMAC token (same secret as call-session)
//   3. Messages are JSON: { type, ...payload }
//   4. Server broadcasts each message to all OTHER sockets in the same call
//
// Message types (pass-through, relay doesn't interpret):
//   offer, answer, ice-candidate, call-end, ping/pong
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_HMAC_SECRET = Deno.env.get("RELAY_HMAC_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── In-memory rooms ──────────────────────────────────────────────────────────
// Map<callId, Set<WebSocket>>
const callRooms = new Map<string, Set<WebSocket>>();

// Cleanup empty rooms periodically (every 60s)
setInterval(() => {
  for (const [callId, sockets] of callRooms) {
    // Remove closed sockets
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        sockets.delete(ws);
      }
    }
    if (sockets.size === 0) callRooms.delete(callId);
  }
}, 60_000);

// ── HMAC verification ────────────────────────────────────────────────────────
async function verifyHmacToken(
  token: string,
  secret: string,
): Promise<{ sub: string; room: string; call: string } | null> {
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signatureInput = `${parts[0]}.${parts[1]}`;

    // Decode base64url signature
    const sigB64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigBin = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBin,
      enc.encode(signatureInput),
    );
    if (!valid) return null;

    // Decode payload
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(payloadB64));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    if (!payload.sub || !payload.call) return null;

    return { sub: payload.sub, room: payload.room ?? "", call: payload.call };
  } catch {
    return null;
  }
}

// ── Broadcast to other sockets in the same call ──────────────────────────────
function broadcastToCall(callId: string, sender: WebSocket, message: string) {
  const room = callRooms.get(callId);
  if (!room) return;

  for (const ws of room) {
    if (ws !== sender && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch {
        // Socket gone, will be cleaned up
      }
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check (non-WS GET)
  const upgradeHeader = req.headers.get("upgrade") ?? "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response(
      JSON.stringify({ status: "ok", protocol: "signaling-relay/v1" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── WebSocket upgrade ──────────────────────────────────────────────────
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const callId = url.searchParams.get("call");

  if (!token || !callId) {
    return new Response(
      JSON.stringify({ error: "Missing token or call query param" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Verify HMAC token
  const claims = await verifyHmacToken(token, RELAY_HMAC_SECRET);
  if (!claims) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Ensure the token's call claim matches the requested call
  if (claims.call !== callId) {
    return new Response(
      JSON.stringify({ error: "Token call mismatch" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Upgrade to WebSocket
  const { socket, response } = Deno.upgradeWebSocket(req);

  // Join the call room
  if (!callRooms.has(callId)) {
    callRooms.set(callId, new Set());
  }
  callRooms.get(callId)!.add(socket);

  const userId = claims.sub;
  console.log(`[relay] ${userId} joined call ${callId} (room size: ${callRooms.get(callId)!.size})`);

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;

    // Handle ping
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
    } catch {
      // Not JSON, ignore
      return;
    }

    // Broadcast to other participants
    broadcastToCall(callId, socket, event.data);
  };

  socket.onclose = () => {
    const room = callRooms.get(callId);
    if (room) {
      room.delete(socket);
      console.log(`[relay] ${userId} left call ${callId} (room size: ${room.size})`);
      if (room.size === 0) callRooms.delete(callId);
    }
  };

  socket.onerror = (err) => {
    console.error(`[relay] socket error for ${userId} in call ${callId}:`, err);
  };

  return response;
});
