import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildLoanStatementResponse } from "../_shared/buildLoanStatement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "Missing token" }, 400);
    // Default redacted: the public /statements/:token page never receives the
    // USDT quantity or the QAR conversion rate. Cash Management's own inline
    // preview opts in with ?internal=1 to keep showing the full breakdown.
    const clientSafe = url.searchParams.get("internal") !== "1";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Service-role client — the only piece of this function allowed to bypass
    // RLS. It never accepts or forwards any client-supplied credentials.
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: link, error: linkError } = await supabase
      .from("buyer_statement_links")
      .select("user_id, customer_id, currency")
      .eq("token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (linkError) throw linkError;
    if (!link) return json({ error: "Not found" }, 404);

    const response = await buildLoanStatementResponse(supabase, link, clientSafe);
    if (!response) return json({ error: "Not found" }, 404);

    return json(response);
  } catch (err) {
    console.error("public-buyer-statement error:", err);
    return json({ error: "Server error" }, 500);
  }
});
