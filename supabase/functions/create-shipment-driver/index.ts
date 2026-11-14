import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Same synthetic address scheme as admin-create-customer-login: the driver only ever types a
// username, and the login page appends this domain.
const USERNAME_EMAIL_DOMAIN = "customers.local";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MAX_DRIVERS_PER_CUSTOMER = 25;

// Lets a customer create a username/password login for one of their drivers. Runs with the
// service-role key because it creates an auth user and a profile for someone other than the caller.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await authed.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const customerId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: customer, error: customerError } = await admin
      .from("customer_profiles").select("user_id").eq("user_id", customerId).maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json({ error: "Only customers can add drivers" }, 403);

    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim().slice(0, 32) : null;
    const truckPlate = typeof body.truckPlate === "string" && body.truckPlate.trim() ? body.truckPlate.trim().slice(0, 32) : null;

    if (!USERNAME_RE.test(username)) {
      return json({ error: "Username must be 3-32 characters: lowercase letters, numbers, dots, dashes, or underscores" }, 400);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!displayName || displayName.length > 80) return json({ error: "Driver name is required (up to 80 characters)" }, 400);

    const { count } = await admin
      .from("shipment_drivers").select("id", { count: "exact", head: true }).eq("owner_customer_user_id", customerId);
    if ((count ?? 0) >= MAX_DRIVERS_PER_CUSTOMER) return json({ error: "Driver limit reached" }, 409);

    const email = `${username}@${USERNAME_EMAIL_DOMAIN}`;
    // portal "driver" (not "customer"): the signup trigger must not give this account a customer profile.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username, portal: "driver" },
    });
    if (createError) {
      const duplicate = /already.*registered|already exists/i.test(createError.message);
      return json({ error: duplicate ? "That username is already taken" : createError.message }, duplicate ? 409 : 500);
    }
    const driverUserId = created.user.id;

    try {
      const { error: profileError } = await admin
        .from("profiles")
        .upsert({ user_id: driverUserId, email, role: "driver", status: "approved", username }, { onConflict: "user_id" });
      if (profileError) throw profileError;

      const { data: driver, error: driverError } = await admin
        .from("shipment_drivers")
        .insert({ user_id: driverUserId, owner_customer_user_id: customerId, username, display_name: displayName, phone, truck_plate: truckPlate })
        .select("id")
        .single();
      if (driverError) throw driverError;

      return json({ driverId: driver.id, username });
    } catch (err) {
      // No half-made driver: remove the auth user (cascades to everything created above).
      await admin.auth.admin.deleteUser(driverUserId).catch(() => {});
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    console.error("create-shipment-driver failed:", message);
    return json({ error: message }, 500);
  }
});
