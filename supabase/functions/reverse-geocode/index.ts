import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { cacheKey, placeFromAddress, validCoordinates, type PlaceName } from "./place.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// OpenStreetMap's public geocoder asks for an identifying User-Agent and at most one request a second.
const USER_AGENT = "TheTracker-shipments/1.0 (reverse geocoding for truck location names)";
const cache = new Map<string, { ar: PlaceName | null; en: PlaceName | null }>();
let lastCallAt = 0;

async function lookup(lat: number, lng: number, lang: "ar" | "en"): Promise<PlaceName | null> {
  const wait = lastCallAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=${lang}&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return placeFromAddress(data?.address);
}

// Names the area a point is in, in Arabic and English, for the driver's phone to stamp on a photo and send with
// each location. Only an active shipment driver may call it.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authed = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await authed.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: driver } = await admin
      .from("shipment_drivers").select("id").eq("user_id", userData.user.id).eq("active", true).maybeSingle();
    if (!driver) return json({ error: "Only shipment drivers can use this" }, 403);

    const body = await req.json().catch(() => ({}));
    const { latitude, longitude } = body;
    if (!validCoordinates(latitude, longitude)) return json({ error: "Invalid coordinates" }, 400);

    const key = cacheKey(latitude, longitude);
    let hit = cache.get(key);
    if (!hit) {
      const ar = await lookup(latitude, longitude, "ar");
      const en = await lookup(latitude, longitude, "en");
      hit = { ar, en };
      if (ar || en) {
        if (cache.size > 500) cache.clear();
        cache.set(key, hit);
      }
    }
    return json({ available: !!(hit.ar || hit.en), ar: hit.ar, en: hit.en });
  } catch (e) {
    console.error("reverse-geocode failed", e);
    return json({ available: false });
  }
});
