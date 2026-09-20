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
  { id: "egypt", fiat: "EGP", asset: "USDT" },
];

async function fetchBinanceP2P(
  fiat: string,
  tradeType: "BUY" | "SELL",
  asset = "USDT",
  rows = 10,
  payTypes: string[] = [],
  classifies: string[] | null = ["mass"],
): Promise<BinanceP2POffer[]> {
  const body: Record<string, unknown> = {
    fiat,
    page: 1,
    rows,
    tradeType,
    asset,
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    publisherType: null,
    payTypes,
  };

  // Relaxed classifies to ensure results in smaller markets. Passing null skips
  // the filter entirely, which a narrow payTypes query needs to find enough ads.
  if (classifies) body.classifies = classifies;

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
  banqueMisrRaw: BinanceP2POffer[] = [],
  banqueMisrEmergencyRaw: BinanceP2POffer[] = [],
) {
  const sellOffers = parseOffers(buyRaw).sort((a, b) => b.price - a.price);
  const buyOffers = parseOffers(sellRaw).sort((a, b) => a.price - b.price);

  const topNForAvg = marketId === "qatar" ? 5 : 20;
  const topSell = sellOffers.slice(0, topNForAvg);
  const topBuy = buyOffers.slice(0, topNForAvg);

  const sellAvg =
    topSell.length > 0
      ? topSell.reduce((s, o) => s + o.price, 0) / topSell.length
      : null;

  // Dedicated Banque Misr sell book. The unfiltered top-20 above almost never
  // contains enough Banque Misr ads to average, so these come from a separate
  // payTypes-filtered query. Cheapest first, same direction as buyOffers.
  const banqueMisrSellOffers = parseOffers(banqueMisrRaw).sort(
    (a, b) => a.price - b.price,
  );

  // Egypt's buyAvg is the merchant-facing "average selling price" quote, so
  // it has to reflect a payment method buyers can actually use, not the
  // generic top-20 book (mixes in low-liquidity/unusable methods and skews
  // the average up). Banque Misr's own top 8 cheapest ads instead; falls
  // back to the generic top-N average only when too few Banque Misr ads
  // exist to average meaningfully.
  const topBanqueMisr = banqueMisrSellOffers.slice(0, 8);
  const buyAvg =
    marketId === "egypt" && topBanqueMisr.length > 0
      ? topBanqueMisr.reduce((s, o) => s + o.price, 0) / topBanqueMisr.length
      : topBuy.length > 0
      ? topBuy.reduce((s, o) => s + o.price, 0) / topBuy.length
      : null;

  // "Emergency price" — a second Banque Misr quote from the *other* side of
  // the book (Binance's own Sell tab: tradeType SELL returns the buyer ads
  // you'd sell into, highest price first) meant to read as "what you could
  // realistically get if you had to sell right now", as distinct from
  // buyAvg above. The single best-priced ad is dropped before averaging --
  // it's routinely an outlier (tiny limit, unreliable advertiser) that
  // doesn't reflect what a real trade would clear at -- so this is ranks
  // 2-9 (skip the first, then take the next 8), highest price first.
  const banqueMisrEmergencyOffers = parseOffers(banqueMisrEmergencyRaw).sort(
    (a, b) => b.price - a.price,
  );
  const topEmergency = banqueMisrEmergencyOffers.slice(1, 9);
  const emergencyAvg =
    marketId === "egypt" && topEmergency.length > 0
      ? topEmergency.reduce((s, o) => s + o.price, 0) / topEmergency.length
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
    banqueMisrSellOffers,
    banqueMisrEmergencyOffers,
    sellAvg,
    buyAvg,
    emergencyAvg,
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
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const marketParam = url.searchParams.get("market") ?? body.market ?? null;
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
        const [sellRaw, buyRaw, banqueMisrRaw, banqueMisrEmergencyRaw] = await Promise.all([
          fetchBinanceP2P(market.fiat, "SELL", market.asset, apiRows),
          fetchBinanceP2P(market.fiat, "BUY", market.asset, apiRows),
          market.id === "egypt"
            ? fetchBinanceP2P(market.fiat, "BUY", market.asset, 20, ["BanqueMisr"], null)
            : Promise.resolve([]),
          // "Emergency price" — Binance's own Sell tab (tradeType SELL) for
          // the same Banque Misr filter, the other side of the book from
          // banqueMisrRaw above.
          market.id === "egypt"
            ? fetchBinanceP2P(market.fiat, "SELL", market.asset, 20, ["BanqueMisr"], null)
            : Promise.resolve([]),
        ]);

        const snapshot = buildSnapshot(sellRaw, buyRaw, market.id, banqueMisrRaw, banqueMisrEmergencyRaw);

        const { error } = await supabase.from("p2p_snapshots").insert({
          market: market.id,
          data: snapshot,
        });

        if (error) {
          console.error(`[${market.id}] DB insert FAILED:`, error.message);
        }

        results[market.id] = {
          sellAvg: snapshot.sellAvg,
          buyAvg: snapshot.buyAvg,
          emergencyAvg: snapshot.emergencyAvg,
          spread: snapshot.spread,
          offersCount: {
            sell: snapshot.sellOffers.length,
            buy: snapshot.buyOffers.length,
          },
        };
      } catch (err) {
        results[market.id] = { error: String(err) };
      }
    }

    return new Response(
      JSON.stringify({ ok: true, results, scrapedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
