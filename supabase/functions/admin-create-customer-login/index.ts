import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Synthetic email domain: Supabase Auth requires an email identifier even
// for a username/password login. The customer never sees or uses this
// address — the customer portal login screen accepts only the username and
// translates it to this address client-side before calling
// signInWithPassword, deterministically, with no lookup round-trip.
const USERNAME_EMAIL_DOMAIN = "customers.local";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// Lets a merchant create a username/password login for one of their
// customers (no email required from the customer) and link the new portal
// account to their merchant. Runs with the service-role key because it
// writes profiles/customer_profiles/customer_merchant_connections rows for
// a user_id the calling merchant does not own — no client-side RLS policy
// permits that, by design (see supabase/migrations for those tables).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const merchantAuthId = userData.user.id;

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: merchantProfile, error: merchantError } = await supabase
      .from("merchant_profiles")
      .select("merchant_id, display_name")
      .eq("user_id", merchantAuthId)
      .maybeSingle();
    if (merchantError) throw merchantError;
    if (!merchantProfile) return json({ error: "Only merchants can create customer logins" }, 403);

    const body = await req.json().catch(() => ({}));
    const rawUsername = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;

    if (!USERNAME_RE.test(rawUsername)) {
      return json({ error: "Username must be 3-32 characters: lowercase letters, numbers, dots, dashes, or underscores" }, 400);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!displayName) return json({ error: "Display name is required" }, 400);

    const email = `${rawUsername}@${USERNAME_EMAIL_DOMAIN}`;

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: rawUsername, portal: "customer" },
    });
    if (createError) {
      const isDuplicate = /already.*registered|already exists/i.test(createError.message);
      return json({ error: isDuplicate ? "That username is already taken" : createError.message }, isDuplicate ? 409 : 500);
    }
    const newUserId = created.user.id;

    // handle_new_user() already inserted a public.profiles row on the
    // auth.users insert above, defaulted to role='merchant', status='pending'
    // — flip it to an approved customer account.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ role: "customer", status: "approved" })
      .eq("user_id", newUserId);
    if (profileError) throw profileError;

    const { error: customerProfileError } = await supabase
      .from("customer_profiles")
      .insert({ user_id: newUserId, display_name: displayName, phone, status: "active" });
    if (customerProfileError) throw customerProfileError;

    // "active" — not "accepted" — is the status value the order-placement
    // path actually recognizes (see CustomerOrdersPage's connections query
    // and the create_customer_order_request RPC, both of which filter on
    // status IN ('pending','active')). An "accepted" row is invisible to
    // both, silently blocking every "New Order" button for this customer.
    const { error: connectionError } = await supabase
      .from("customer_merchant_connections")
      .insert({
        customer_user_id: newUserId,
        merchant_id: merchantProfile.merchant_id,
        status: "active",
        nickname: displayName,
      });
    if (connectionError) throw connectionError;

    return json({ userId: newUserId, username: rawUsername, displayName });
  } catch (err) {
    console.error("admin-create-customer-login error:", err);
    return json({ error: "Server error" }, 500);
  }
});
