import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { parseBankMisrQarNotes } from "./parse.ts";

const SOURCE_URL = "https://www.banquemisr.com/en/CAPITAL-MARKETS/Exchange-Rates-and-Currencies";
// The function is callable without a JWT (the cron job posts to it like the other
// jobs), so a call inside this window serves the stored rate instead of hitting the bank.
const MIN_REFETCH_MS = 5 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const key = { bank: "bank_misr", currency: "QAR", product: "notes" };

  const { data: existing } = await admin.from("bank_exchange_rates").select("*").match(key).maybeSingle();
  if (existing && Date.now() - new Date(existing.fetched_at).getTime() < MIN_REFETCH_MS) {
    return json({ ...existing, cached: true });
  }

  try {
    const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TrackerRateBot/1.0)" } });
    if (!res.ok) throw new Error(`Banque Misr responded ${res.status}`);
    const rate = parseBankMisrQarNotes(await res.text());
    if (!rate) throw new Error("QATARI Riyal notes row not found or out of range");

    const row = { ...key, buy: rate.buy, sell: rate.sell, fetched_at: new Date().toISOString() };
    const { error } = await admin.from("bank_exchange_rates").upsert(row, { onConflict: "bank,currency,product" });
    if (error) throw error;
    return json(row);
  } catch (err) {
    // Keep serving the last good rate; the customer portal shows its fetched_at.
    const message = err instanceof Error ? err.message : String(err);
    console.error("bank-misr-rates failed:", message);
    return json({ error: message, last: existing ?? null }, 502);
  }
});
