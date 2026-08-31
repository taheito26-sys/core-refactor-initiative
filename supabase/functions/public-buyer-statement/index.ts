import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildBuyerStatements } from "../../../src/features/stock/utils/loanStatement.ts";

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

    const { data: snapshot, error: snapshotError } = await supabase
      .from("tracker_snapshots")
      .select("state")
      .eq("user_id", link.user_id)
      .maybeSingle();

    if (snapshotError) throw snapshotError;
    if (!snapshot?.state) return json({ error: "Not found" }, 404);

    const state = snapshot.state as { customers?: unknown; customerLoans?: unknown };
    const statements = buildBuyerStatements({
      // deno-lint-ignore no-explicit-any
      loans: (state.customerLoans ?? []) as any,
      // deno-lint-ignore no-explicit-any
      customers: (state.customers ?? []) as any,
      now: Date.now(),
    });

    // A buyer can carry loans in more than one currency (separate statements) —
    // the link is scoped to one, so match both fields, not customerId alone.
    const statement = statements.find((s) => s.customerId === link.customer_id && s.currency === link.currency);
    if (!statement) return json({ error: "Not found" }, 404);

    const response = {
      customerName: statement.customerName,
      currency: statement.currency,
      totalLoaned: Math.round(statement.totalLoaned),
      totalRepaid: Math.round(statement.totalRepaid),
      outstanding: Math.round(statement.outstanding),
      issueDate: new Date().toISOString().slice(0, 10),
      payments: statement.entries
        .filter((e) => e.kind === "payment")
        .map((e) => ({
          date: e.ts,
          amount: Math.round(e.credit),
          note: e.description || null,
          ref: e.ref || null,
        })),
    };

    return json(response);
  } catch (err) {
    console.error("public-buyer-statement error:", err);
    return json({ error: "Server error" }, 500);
  }
});
