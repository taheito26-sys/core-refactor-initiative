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

async function fetchFromInstapay(sourceCurrency: string = "qar", targetCurrency: string = "egp"): Promise<FxRateResponse | null> {
  try {
    // INSTAPAY V1 market rates endpoint
    const currencyPair = `${sourceCurrency}-${targetCurrency}`;
    const endpoint = `${INSTAPAY_API_BASE}/rates/${currencyPair}`;
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

    // Ensure rate is reasonable (QAR to EGP should be around 13-14)
    // Correct rate: 1 QAR ≈ 13.9253 EGP
    if (rate < 5 || rate > 20) {
      console.warn("Unusual FX rate detected:", rate, "- expected range is ~13-14 for QAR→EGP");
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
    // Parse query parameters for currency pair
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || "qar";
    const target = url.searchParams.get("target") || "egp";
    console.log(`Fetching rate for ${source}-${target}`);

    const fxData = await fetchFromInstapay(source, target);

    if (!fxData) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch rate",
          rate: 13.9253, // fallback (1 QAR = 13.9253 EGP from QAR/EGP market guide)
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
        rate: 13.9253, // fallback (1 QAR = 13.9253 EGP from QAR/EGP market guide)
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
