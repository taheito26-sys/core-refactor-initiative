import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { parseScreenReading } from "./parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("REEFER_READER_MODEL") ?? "claude-haiku-5-5";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// About 1.4 MB of image once decoded; the app sends a ~1000 px JPEG, far below this.
const MAX_BASE64_CHARS = 1_900_000;

const SYSTEM = `You read the display of a Thermo King SmartReefer refrigeration unit on a truck. Labels may be in Arabic or English.
The display shows two numbers: the CURRENT compartment temperature in large digits (Arabic label "درجة الحرارة", English "Return Air" or "Temp"), and the SET POINT in smaller digits (Arabic label "درجة الضبط", English "Setpoint"). A value can have a minus sign and one decimal; the decimal digit is often drawn small after the large digit (a large 8 followed by a small .5 means 8.5).
Reply with ONLY one JSON object: {"readable": true or false, "temperature": number or null, "set_point": number or null}.
Use null for any value you cannot read with confidence. If the screen is blurred, cut off, in glare, or is not a refrigeration display, reply {"readable": false, "temperature": null, "set_point": null}. Never guess a number.`;

// Reads the temperature off a photo of the truck's refrigeration screen so the driver does not have to type
// it. Off until ANTHROPIC_API_KEY is set as a function secret: with no key it answers { available: false }
// and the app falls back to manual entry. Only an active shipment driver may call it.
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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ available: false });

    const body = await req.json().catch(() => ({}));
    const image = typeof body.image === "string" ? body.image : "";
    const mediaType = typeof body.mediaType === "string" ? body.mediaType : "image/jpeg";
    if (!image || image.length > MAX_BASE64_CHARS || !ALLOWED_TYPES.has(mediaType)) return json({ error: "Invalid image" }, 400);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Read the display." },
          ],
        }],
      }),
    });
    if (!res.ok) {
      console.error("read-reefer-temperature: model call failed", res.status, (await res.text()).slice(0, 300));
      return json({ available: true, reading: null });
    }
    const out = await res.json();
    const text = Array.isArray(out.content) ? out.content.map((c: { text?: string }) => c.text ?? "").join("") : "";
    const reading = parseScreenReading(text);
    return json({ available: true, reading: reading ? { temperature: reading.temperature, setPoint: reading.setPoint } : null });
  } catch (err) {
    console.error("read-reefer-temperature failed:", err instanceof Error ? err.message : err);
    return json({ available: true, reading: null });
  }
});
