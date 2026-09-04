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

// Authenticated variant of public-buyer-statement: instead of a shareable
// token, the signed-in customer is matched against buyer_statement_links
// rows a merchant has explicitly attached to their account
// (customer_user_id). Returns every currency statement they're linked to —
// a buyer can carry a QAR loan and an EGP loan at once.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verifies the caller's JWT and resolves auth.uid() — never trusts a
    // client-supplied id.
    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const customerUserId = userData.user.id;

    // Service-role client — the only piece of this function allowed to
    // bypass RLS. It never accepts or forwards any client-supplied
    // credentials; every row it reads is scoped by customerUserId above.
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: links, error: linksError } = await supabase
      .from("buyer_statement_links")
      .select("user_id, customer_id, currency")
      .eq("customer_user_id", customerUserId)
      .is("revoked_at", null);

    if (linksError) throw linksError;
    if (!links || links.length === 0) return json({ statements: [] });

    const statements = [];
    for (const link of links) {
      const statement = await buildLoanStatementResponse(supabase, link, true);
      if (statement) statements.push(statement);
    }

    return json({ statements });
  } catch (err) {
    console.error("customer-loan-statement error:", err);
    return json({ error: "Server error" }, 500);
  }
});
