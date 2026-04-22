import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-id, content-type",
};

// INSTAPAY V1 API endpoints
const INSTAPAY_API_BASE = "https://api.instapay.me/api/v1";

interface FxRateResponse {
  rate: number;
  source: string;
  timestamp: string;
}

async function fetchFromInstapay(): Promise<FxRateResponse | null> {
  try {
    // INSTAPAY V1 market rates endpoint for QAR to EGP conversion
    const endpoint = `${INSTAPAY_API_BASE}/rates/qar-egp`;
    console.log("Fetching from INSTAPAY:", endpoint);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("INSTAPAY API error:", response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    console.log("INSTAPAY response:", JSON.stringify(data));

    // Extract rate from response - try multiple field names
    // INSTAPAY might return: rate, buy_price, price, buy, sell, or nested in data object
    let rate =
      data?.rate ??
      data?.buy_price ??
      data?.price ??
      data?.buy ??
      data?.sell ??
      data?.data?.rate ??
      data?.data?.buy_price ??
      null;

    // Handle string rates
    if (typeof rate === "string") {
      rate = parseFloat(rate);
    }

    if (!rate || isNaN(rate) || rate <= 0) {
      console.error("Invalid rate from INSTAPAY - extracted value:", rate, "Full response:", data);
      return null;
    }

    // Ensure rate is reasonable (QAR to EGP should be around 0.25-0.30)
    if (rate < 0.1 || rate > 1) {
      console.warn("Unusual FX rate detected:", rate, "- may need to reverse direction or verify API");
    }

    return {
      rate: parseFloat(rate.toFixed(6)),
      source: "instapay_v1",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("INSTAPAY fetch exception:", error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const fxData = await fetchFromInstapay();

    if (!fxData) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch rate",
          rate: 0.27, // fallback
          source: "default",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200, // Return 200 with fallback
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(fxData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({
        error: "Server error",
        rate: 0.27, // fallback
        source: "default",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200, // Return 200 with fallback
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
