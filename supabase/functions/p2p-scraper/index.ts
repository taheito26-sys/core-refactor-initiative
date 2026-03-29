import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BinanceP2POffer {
  adv: {
    advNo: string;
    price: string;
    surplusAmount: string;
    minSingleTransAmount: string;
    maxSingleTransAmount: string;
    tradeMethods: { identifier: string; tradeMethodName: string }[];
  };
  advertiser: {
    nickName: string;
    monthOrderCount: number;
    monthFinishRate: number;
  };
}

interface MarketConfig {
  id: string;
  fiat: string;
  asset: string;
}

const MARKETS: MarketConfig[] = [
  { id: "qatar", fiat: "QAR", asset: "USDT" },
  { id: "uae", fiat: "AED", asset: "USDT" },
  { id: "egypt", fiat: "EGP", asset: "USDT" },
  { id: "ksa", fiat: "SAR", asset: "USDT" },
  { id: "turkey", fiat: "TRY", asset: "USDT" },
  { id: "oman", fiat: "OMR", asset: "USDT" },
  { id: "georgia", fiat: "GEL", asset: "USDT" },
  { id: "kazakhstan", fiat: "KZT", asset: "USDT" },
];

async function fetchBinanceP2P(
  fiat: string,
  tradeType: "BUY" | "SELL",
  asset = "USDT",
  rows = 10
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
    }
  );

  if (!res.ok) {
    console.error(`Binance P2P API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = await res.json();
  return json.data || [];
}

function parseOffers(raw: BinanceP2POffer[]) {
  return raw.map((o) => ({
    price: parseFloat(o.adv.price),
    min: parseFloat(o.adv.minSingleTransAmount),
    max: parseFloat(o.adv.maxSingleTransAmount || "0"),
    available: parseFloat(o.adv.surplusAmount),
    nick: o.advertiser.nickName,
    trades: o.advertiser.monthOrderCount || 0,
    completion: o.advertiser.monthFinishRate || 0,
    methods: o.adv.tradeMethods.map((m) => m.tradeMethodName || m.identifier),
  }));
}

function buildSnapshot(
  sellRaw: BinanceP2POffer[],
  buyRaw: BinanceP2POffer[],
  marketId: string,
) {
  // sellRaw = Binance SELL ads = people selling USDT = YOUR restock source
  // buyRaw = Binance BUY ads = people buying USDT = YOUR sell targets
  const sellOffers = parseOffers(buyRaw).sort((a, b) => b.price - a.price);   // highest first
  const buyOffers = parseOffers(sellRaw).sort((a, b) => a.price - b.price);   // cheapest first

  const topNForAvg = marketId === "qatar" ? 5 : 10;
  const topSell = sellOffers.slice(0, topNForAvg);
  const topBuy = buyOffers.slice(0, topNForAvg);

  const sellAvg =
    topSell.length > 0
      ? topSell.reduce((s, o) => s + o.price, 0) / topSell.length
      : null;
  const buyAvg =
    topBuy.length > 0
      ? topBuy.reduce((s, o) => s + o.price, 0) / topBuy.length
      : null;

  const bestSell = sellOffers.length > 0 ? sellOffers[0].price : null;
  const bestBuy = buyOffers.length > 0 ? buyOffers[0].price : null;

  const spread =
    sellAvg != null && buyAvg != null ? sellAvg - buyAvg : null;
  const spreadPct =
    spread != null && buyAvg != null && buyAvg > 0
      ? (spread / buyAvg) * 100
      : null;

  const sellDepth = sellOffers.reduce((s, o) => s + o.available, 0);
  const buyDepth = buyOffers.reduce((s, o) => s + o.available, 0);

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const marketParam = url.searchParams.get("market");
    const marketsToScrape = marketParam
      ? MARKETS.filter((m) => m.id === marketParam)
      : MARKETS;

    if (marketsToScrape.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown market: ${marketParam}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const results: Record<string, any> = {};

    for (const market of marketsToScrape) {
      try {
        const apiRows = market.id === "qatar" ? 10 : 20;
        const [sellRaw, buyRaw] = await Promise.all([
          fetchBinanceP2P(market.fiat, "SELL", market.asset, apiRows),
          fetchBinanceP2P(market.fiat, "BUY", market.asset, apiRows),
        ]);

        console.log(`[${market.id}] API response: SELL=${sellRaw.length} offers, BUY=${buyRaw.length} offers`);

        const snapshot = buildSnapshot(sellRaw, buyRaw, market.id);

        const { error } = await supabase.from("p2p_snapshots").insert({
          market: market.id,
          data: snapshot,
        });

        if (error) {
          console.error(`[${market.id}] DB insert FAILED:`, error.message);
        } else {
          console.log(`[${market.id}] Snapshot inserted: sellAvg=${snapshot.sellAvg}, buyAvg=${snapshot.buyAvg}, ts=${new Date().toISOString()}`);
        }

        results[market.id] = {
          sellAvg: snapshot.sellAvg,
          buyAvg: snapshot.buyAvg,
          spread: snapshot.spread,
          offersCount: {
            sell: snapshot.sellOffers.length,
            buy: snapshot.buyOffers.length,
          },
        };
      } catch (err) {
        console.error(`[${market.id}] Scrape ERROR:`, String(err));
        results[market.id] = { error: String(err) };
      }
    }

    return new Response(
      JSON.stringify({ ok: true, results, scrapedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("P2P scraper error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
