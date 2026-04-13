import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Binance API types ───────────────────────────────────────────────────────

interface BinanceP2POffer {
  adv: {
    advNo: string;
    tradeType: string;         // 'BUY' | 'SELL'
    price: string;
    surplusAmount: string;
    minSingleTransAmount: string;
    maxSingleTransAmount: string;
    tradeMethods: { identifier: string; tradeMethodName: string }[];
    avgPayTime?: number;       // avg pay time in minutes
    avgReleaseTime?: number;   // avg release time in minutes
    remarks?: string;          // advertiser message
    autoReplyMsg?: string;
  };
  advertiser: {
    nickName: string;
    monthOrderCount: number;
    monthFinishRate: number;   // completion rate 0..1
    positiveRate?: number;     // feedback rate 0..1
    userType?: string;         // 'user' | 'merchant' | 'pro-merchant'
    userTradeCount?: number;   // all-time trade count
  };
}

// ── Market configuration ────────────────────────────────────────────────────

interface MarketConfig {
  id: string;
  fiat: string;
  asset: string;
  avgTop: number; // how many top offers to average (qatar=5, others=20)
}

const MARKETS: MarketConfig[] = [
  { id: "qatar",      fiat: "QAR", asset: "USDT", avgTop: 5  },
  { id: "uae",        fiat: "AED", asset: "USDT", avgTop: 20 },
  { id: "egypt",      fiat: "EGP", asset: "USDT", avgTop: 20 },
  { id: "ksa",        fiat: "SAR", asset: "USDT", avgTop: 20 },
  { id: "turkey",     fiat: "TRY", asset: "USDT", avgTop: 20 },
  { id: "oman",       fiat: "OMR", asset: "USDT", avgTop: 20 },
  { id: "georgia",    fiat: "GEL", asset: "USDT", avgTop: 20 },
  { id: "kazakhstan", fiat: "KZT", asset: "USDT", avgTop: 20 },
];

// ── Binance fetch ───────────────────────────────────────────────────────────────

async function fetchBinanceP2P(
  fiat: string,
  tradeType: "BUY" | "SELL",
  asset = "USDT",
  rows = 20,
): Promise<BinanceP2POffer[]> {
  const body = {
    fiat,
    page: 1,
    rows,
    tradeType,
    asset,
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    publisherType: null,
    payTypes: [],
    classifies: ["mass", "profession", "fiat_trade"],
  };

  const res = await fetch(
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    console.error(`Binance P2P API error for ${fiat}/${tradeType}: ${res.status}`);
    return [];
  }

  const json = await res.json();
  return json.data || [];
}

// ── Offer parser ───────────────────────────────────────────────────────────────────

function parseOffers(
  raw: BinanceP2POffer[],
  originalTradeType: "BUY" | "SELL",
) {
  return raw.map(o => {
    const message =
      (o.adv.remarks && o.adv.remarks.trim()) ||
      (o.adv.autoReplyMsg && o.adv.autoReplyMsg.trim()) ||
      null;

    return {
      price:     parseFloat(o.adv.price),
      min:       parseFloat(o.adv.minSingleTransAmount),
      max:       parseFloat(o.adv.maxSingleTransAmount || "0"),
      available: parseFloat(o.adv.surplusAmount),
      nick:      o.advertiser.nickName,
      trades:    o.advertiser.monthOrderCount  || 0,
      completion: o.advertiser.monthFinishRate || 0,
      // Extended fields (may be absent in some responses)
      ...(o.advertiser.positiveRate   != null && { feedback:      o.advertiser.positiveRate }),
      ...(o.advertiser.userType       != null && { status:        o.advertiser.userType }),
      ...(o.advertiser.userTradeCount != null && { allTimeTrades: o.advertiser.userTradeCount }),
      ...(o.adv.avgPayTime     != null && { avgPay:     o.adv.avgPayTime }),
      ...(o.adv.avgReleaseTime != null && { avgRelease: o.adv.avgReleaseTime }),
      ...(message !== null            && { message }),
      tradeType: originalTradeType, // store Binance's original tradeType for audit
      methods:   o.adv.tradeMethods.map(
        (m) => m.tradeMethodName || m.identifier,
      ),
    };
  });
}

// ── Snapshot builder ─────────────────────────────────────────────────────────────

function buildSnapshot(
  sellRaw: BinanceP2POffer[], // Binance SELL ads  = others selling USDT = our restock source
  buyRaw:  BinanceP2POffer[], // Binance BUY  ads  = others buying  USDT = our sell targets
  avgTop: number,
) {
  // Business semantics (intentionally inverted from Binance tradeType):
  //   sellOffers = from Binance BUY  ads (highest first) → market will pay us
  //   buyOffers  = from Binance SELL ads (lowest  first) → cheapest restock
  const sellOffers = parseOffers(buyRaw,  "BUY" ).sort((a, b) => b.price - a.price);
  const buyOffers  = parseOffers(sellRaw, "SELL").sort((a, b) => a.price - b.price);

  const topSell = sellOffers.slice(0, avgTop);
  const topBuy  = buyOffers.slice(0,  avgTop);

  const sellAvg =
    topSell.length > 0
      ? topSell.reduce((s, o) => s + o.price, 0) / topSell.length
      : null;
  const buyAvg =
    topBuy.length > 0
      ? topBuy.reduce((s, o) => s + o.price, 0) / topBuy.length
      : null;

  const bestSell = sellOffers.length > 0 ? sellOffers[0].price : null;
  const bestBuy  = buyOffers.length  > 0 ? buyOffers[0].price  : null;

  const spread =
    sellAvg != null && buyAvg != null ? sellAvg - buyAvg : null;
  const spreadPct =
    spread != null && buyAvg != null && buyAvg > 0
      ? (spread / buyAvg) * 100
      : null;

  const sellDepth = sellOffers.reduce((s, o) => s + o.available, 0);
  const buyDepth  = buyOffers.reduce( (s, o) => s + o.available, 0);

  return {
    ts: Date.now(),
    sellAvg,
    buyAvg,
    bestSell,
    bestBuy,
    spread,
    spreadPct,
    sellDepth,
    buyDepth,
    sellOffers,
    buyOffers,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url          = new URL(req.url);
    const marketParam  = url.searchParams.get("market");
    const marketsToRun = marketParam
      ? MARKETS.filter(m => m.id === marketParam)
      : MARKETS;

    if (marketsToRun.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown market: ${marketParam}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase       = createClient(supabaseUrl, serviceRoleKey);

    const results: Record<string, unknown> = {};

    for (const market of marketsToRun) {
      try {
        const [sellRaw, buyRaw] = await Promise.all([
          fetchBinanceP2P(market.fiat, "SELL", market.asset, 20),
          fetchBinanceP2P(market.fiat, "BUY",  market.asset, 20),
        ]);

        const snapshot = buildSnapshot(sellRaw, buyRaw, market.avgTop);

        const { error } = await supabase
          .from("p2p_snapshots")
          .insert({ market: market.id, data: snapshot });

        if (error) {
          console.error(`Insert failed for ${market.id}:`, error);
        }

        results[market.id] = {
          sellAvg:     snapshot.sellAvg,
          buyAvg:      snapshot.buyAvg,
          spread:      snapshot.spread,
          offersCount: {
            sell: snapshot.sellOffers.length,
            buy:  snapshot.buyOffers.length,
          },
        };
      } catch (err) {
        console.error(`Error scraping ${market.id}:`, err);
        results[market.id] = { error: String(err) };
      }
    }

    return new Response(
      JSON.stringify({ ok: true, results, scrapedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("P2P scraper unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
