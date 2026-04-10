// ─── call-session Edge Function ───────────────────────────────────────────────
//
// Unified call authorization + signaling credential issuance.
// Replaces the old pattern of writing SDP/ICE to Postgres rows.
//
// Actions:
//   start → create call record, return signaling credentials
//   join  → validate call, return signaling credentials
//   end   → mark call ended in database
//
// Returns:
//   { call_id, signaling_url, token, ice_config }
//
// The frontend connects to the signaling WebSocket using the returned URL+token
// instead of reading sdp_offer/sdp_answer/ice_candidates from Postgres rows.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return base64url(sig);
}

async function buildSignalingToken(
  hmacSecret: string,
  userId: string,
  roomId: string,
  callId: string,
  ttlSeconds = 300
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  );
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: userId,
        room: roomId,
        call: callId,
        exp: now + ttlSeconds,
        iat: now,
      })
    )
  );
  const signature = await hmacSign(hmacSecret, `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

// Default ICE configuration — matches frontend resilient-ice.ts
const DEFAULT_ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.nextcloud.com:443" },
  ],
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 4,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const hmacSecret = Deno.env.get("RELAY_HMAC_SECRET");
    const signalingUrl = Deno.env.get("SIGNALING_RELAY_URL") || null;
    const signalingMode = signalingUrl ? "relay" : "supabase_fallback";
    const signalingChannel = signalingUrl ? "relay" : "supabase";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify user
    const jwt = authHeader.slice(7);
    const {
      data: { user },
      error: authErr,
    } = await adminClient.auth.getUser(jwt);
    if (authErr || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const roomId: string | undefined = body.room_id;
    const callId: string | undefined = body.call_id;
    const endReason: string = body.end_reason || "ended";

    if (!action || !["start", "join", "end"].includes(action)) {
      return json({ error: "Invalid action. Use: start, join, end" }, 400);
    }

    if (!roomId && action !== "end") {
      return json({ error: "room_id is required" }, 400);
    }

    if (action === "end" && !callId) {
      return json({ error: "call_id is required for end action" }, 400);
    }

    // ── Validate room membership ─────────────────────────────────────────
    if (roomId) {
      const { data: membership } = await adminClient
        .from("chat_room_members")
        .select("id")
        .eq("room_id", roomId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (!membership) {
        return json({ error: "Not a member of this room" }, 403);
      }
    }

    // ── Validate call policy ─────────────────────────────────────────────
    if (roomId && (action === "start" || action === "join")) {
      const { data: room } = await adminClient
        .from("chat_rooms")
        .select("policy_id")
        .eq("id", roomId)
        .maybeSingle();

      if (room?.policy_id) {
        const { data: policy } = await adminClient
          .from("chat_room_policies")
          .select("allow_calls")
          .eq("id", room.policy_id)
          .maybeSingle();

        if (policy && !policy.allow_calls) {
          return json({ error: "Calls are not allowed in this room" }, 403);
        }
      }
    }

    // ── START ─────────────────────────────────────────────────────────────
    if (action === "start") {
      const requestedCallId = callId || crypto.randomUUID();
      const { data, error: startErr } = await adminClient.rpc("chat_initiate_call", {
        _room_id: roomId!,
        _call_id: requestedCallId,
        _ice_config: DEFAULT_ICE_CONFIG,
      });

      if (startErr) {
        console.error("call-session start error:", startErr);
        return json({ error: startErr.message || "Failed to create call" }, 500);
      }

      const resolvedCallId = (data as string | null) || requestedCallId;
      let token: string | null = null;
      if (hmacSecret) {
        token = await buildSignalingToken(
          hmacSecret,
          user.id,
          roomId!,
          resolvedCallId
        );
      }

      return json({
        call_id: resolvedCallId,
        signaling_url: signalingUrl,
        token,
        ice_config: DEFAULT_ICE_CONFIG,
        signaling_mode: signalingMode,
      });
    }

    // ── JOIN ──────────────────────────────────────────────────────────────
    if (action === "join") {
      let resolvedCallId = callId || null;
      let resolvedRoomId = roomId!;

      let callQuery = adminClient
        .from("chat_calls")
        .select("id, room_id, status")
        .in("status", ["ringing", "active"])
        .order("started_at", { ascending: false })
        .limit(1);

      callQuery = callId
        ? callQuery.eq("id", callId)
        : callQuery.eq("room_id", roomId!);

      const { data: call, error: callErr } = await callQuery.maybeSingle();

      if (callErr) {
        console.error("call-session join lookup error:", callErr);
        return json({ error: "Failed to load call" }, 500);
      }

      if (!call) {
        return json({ error: "No active call found" }, 404);
      }

      resolvedCallId = call.id;
      resolvedRoomId = call.room_id;

      const { data: memberCheck } = await adminClient
        .from("chat_room_members")
        .select("id")
        .eq("room_id", resolvedRoomId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (!memberCheck) {
        return json({ error: "Not a member of this call's room" }, 403);
      }

      let token: string | null = null;
      if (hmacSecret && resolvedCallId) {
        token = await buildSignalingToken(
          hmacSecret,
          user.id,
          resolvedRoomId,
          resolvedCallId
        );
      }

      return json({
        call_id: resolvedCallId,
        signaling_url: signalingUrl,
        token,
        ice_config: DEFAULT_ICE_CONFIG,
        signaling_mode: signalingMode,
      });
    }

    // ── END ──────────────────────────────────────────────────────────────
    if (action === "end") {
      const { data: call, error: callErr } = await adminClient
        .from("chat_calls")
        .select("id, room_id")
        .eq("id", callId!)
        .maybeSingle();

      if (callErr) {
        console.error("call-session end lookup error:", callErr);
        return json({ error: "Failed to load call" }, 500);
      }

      if (!call) {
        return json({ error: "Call not found" }, 404);
      }

      const { data: memberCheck } = await adminClient
        .from("chat_room_members")
        .select("id")
        .eq("room_id", call.room_id)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (!memberCheck) {
        return json({ error: "Not a member of this call's room" }, 403);
      }

      const { error: endErr } = await adminClient.rpc("chat_end_call", {
        _call_id: callId!,
        _end_reason: endReason,
        _signaling_channel: signalingChannel,
      });

      if (endErr) {
        console.error("call-session end error:", endErr);
        return json({ error: endErr.message || "Failed to end call" }, 500);
      }

      return json({ call_id: callId, status: "ended" });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("call-session error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
