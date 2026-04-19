import { createClient } from '@supabase/supabase-js';
import type { Json } from '@/integrations/supabase/types';

type MarketSnapshotRow = {
  market: string;
  fetched_at: string | null;
  data: Record<string, unknown> | null;
};

const LIVE_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
let liveRefreshPromise: Promise<void> | null = null;
const publicSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

export type CustomerMarketCard = {
  market: 'qatar' | 'egypt';
  label: 'Qatar' | 'Egypt';
  buyAvg: number | null;
  sellAvg: number | null;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPct: number | null;
  fetchedAt: string | null;
  snapshot: Json | null;
};

export type QatarEgyptGuideRate = {
  source: 'INSTAPAY_V1' | null;
  rate: number | null;
  timestamp: string | null;
  snapshot: Json | null;
  marketPair: 'QAR/EGP';
};

export type CustomerMarketKpis = {
  qatar: CustomerMarketCard | null;
  egypt: CustomerMarketCard | null;
  guide: QatarEgyptGuideRate;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getSnapshotAgeMs(row: MarketSnapshotRow | null) {
  if (!row?.fetched_at) return Number.POSITIVE_INFINITY;
  const fetchedAtMs = new Date(row.fetched_at).getTime();
  if (!Number.isFinite(fetchedAtMs)) return Number.POSITIVE_INFINITY;
  return Date.now() - fetchedAtMs;
}

export async function refreshP2PSnapshotsIfStale() {
  if (liveRefreshPromise) {
    return liveRefreshPromise;
  }

  liveRefreshPromise = (async () => {
    const [qatarRow, egyptRow] = await Promise.all([
      fetchLatestSnapshot('qatar'),
      fetchLatestSnapshot('egypt'),
    ]);

    const qatarStale = getSnapshotAgeMs(qatarRow) > LIVE_SNAPSHOT_MAX_AGE_MS;
    const egyptStale = getSnapshotAgeMs(egyptRow) > LIVE_SNAPSHOT_MAX_AGE_MS;

    if (!qatarStale && !egyptStale) {
      return;
    }

    const marketsToRefresh: Array<'qatar' | 'egypt'> = [];
    if (qatarStale) marketsToRefresh.push('qatar');
    if (egyptStale) marketsToRefresh.push('egypt');

    const staleBefore = Math.max(getSnapshotAgeMs(qatarRow), getSnapshotAgeMs(egyptRow));
    await Promise.allSettled(
      marketsToRefresh.map((market) =>
        publicSupabase.functions.invoke('p2p-scraper', {
          body: { market },
        }),
      ),
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const [freshQatarRow, freshEgyptRow] = await Promise.all([
        fetchLatestSnapshot('qatar'),
        fetchLatestSnapshot('egypt'),
      ]);

      const freshAge = Math.max(getSnapshotAgeMs(freshQatarRow), getSnapshotAgeMs(freshEgyptRow));
      if (freshAge < staleBefore) {
        break;
      }
    }
  })().finally(() => {
    liveRefreshPromise = null;
  });

  return liveRefreshPromise;
}

async function fetchLatestSnapshot(market: 'qatar' | 'egypt'): Promise<MarketSnapshotRow | null> {
  const { data, error } = await publicSupabase
    .from('p2p_snapshots')
    .select('market, fetched_at, data')
    .eq('market', market)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as MarketSnapshotRow;
}

function toMarketCard(row: MarketSnapshotRow | null, label: 'Qatar' | 'Egypt'): CustomerMarketCard | null {
  if (!row?.data) return null;
  const buyAvg = toFiniteNumber(row.data.buyAvg);
  const sellAvg = toFiniteNumber(row.data.sellAvg);
  const bestBuy = toFiniteNumber(row.data.bestBuy);
  const bestSell = toFiniteNumber(row.data.bestSell);
  const spreadPct = toFiniteNumber(row.data.spreadPct);

  return {
    market: row.market as 'qatar' | 'egypt',
    label,
    buyAvg,
    sellAvg,
    bestBuy,
    bestSell,
    spreadPct,
    fetchedAt: row.fetched_at,
    snapshot: row.data as Json,
  };
}

export async function getQatarEgyptGuideRate(): Promise<QatarEgyptGuideRate> {
  await refreshP2PSnapshotsIfStale();

  const [qatarRow, egyptRow] = await Promise.all([
    fetchLatestSnapshot('qatar'),
    fetchLatestSnapshot('egypt'),
  ]);

  const qatarSellAvg = toFiniteNumber(qatarRow?.data?.sellAvg);
  const egyptBuyAvg = toFiniteNumber(egyptRow?.data?.buyAvg);
  const rate = qatarSellAvg && egyptBuyAvg && qatarSellAvg > 0 && egyptBuyAvg > 0
    ? egyptBuyAvg / qatarSellAvg
    : null;
  const source: QatarEgyptGuideRate['source'] = 'INSTAPAY_V1';

  const timestamp = [qatarRow?.fetched_at, egyptRow?.fetched_at]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

  return {
    source,
    rate,
    timestamp,
    snapshot: {
      source,
      marketPair: 'QAR/EGP',
      qatar: qatarRow ? { fetched_at: qatarRow.fetched_at, data: qatarRow.data } : null,
      egypt: egyptRow ? { fetched_at: egyptRow.fetched_at, data: egyptRow.data } : null,
      qatarSellAvg,
      egyptBuyAvg,
      rate,
      formula: 'egypt.buyAvg / qatar.sellAvg',
    } as Json,
    marketPair: 'QAR/EGP',
  };
}

export async function getCustomerMarketKpis(): Promise<CustomerMarketKpis> {
  await refreshP2PSnapshotsIfStale();

  const [qatarRow, egyptRow, guide] = await Promise.all([
    fetchLatestSnapshot('qatar'),
    fetchLatestSnapshot('egypt'),
    getQatarEgyptGuideRate(),
  ]);

  return {
    qatar: toMarketCard(qatarRow, 'Qatar'),
    egypt: toMarketCard(egyptRow, 'Egypt'),
    guide,
  };
}
