import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Call the existing p2p-scraper for all markets
    const markets = ["qatar", "uae", "egypt", "ksa", "turkey", "oman", "georgia", "kazakhstan", "uganda"];
    const results: Record<string, string> = {};

    for (const market of markets) {
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/p2p-scraper?market=${market}`,
          {
            headers: {
              Authorization: `Bearer ${serviceRoleKey}`,
            },
          }
        );
        const json = await res.json();
        results[market] = json.ok ? "ok" : json.error ?? "unknown error";
      } catch (err) {
        results[market] = String(err);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, results, ts: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});