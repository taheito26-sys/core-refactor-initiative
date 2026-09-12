import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildMonthlyStatementResponse } from "../_shared/buildLoanStatement.ts";

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

const MONTH_RE = /^\d{4}-\d{2}$/;

// Authenticated, month-scoped variant of customer-loan-statement: a signed-in
// buyer can pull their monthly statement (their own cumulative totals and
// payment history, plus the merchant's month-scoped EGP sell ledger) for any
// currency they're linked to, self-service, rather than waiting on the
// merchant to export and send one.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const currency = url.searchParams.get("currency");
    if (!month || !MONTH_RE.test(month)) return json({ error: "Missing or invalid month (expected YYYY-MM)" }, 400);

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

    let linksQuery = supabase
      .from("buyer_statement_links")
      .select("user_id, customer_id, currency")
      .eq("customer_user_id", customerUserId)
      .is("revoked_at", null);
    if (currency) linksQuery = linksQuery.eq("currency", currency);

    const { data: links, error: linksError } = await linksQuery;
    if (linksError) throw linksError;
    if (!links || links.length === 0) return json({ statements: [] });

    const statements = [];
    for (const link of links) {
      const statement = await buildMonthlyStatementResponse(supabase, link, month);
      if (statement) statements.push(statement);
    }

    return json({ statements });
  } catch (err) {
    console.error("customer-monthly-statement error:", err);
    return json({ error: "Server error" }, 500);
  }
});
