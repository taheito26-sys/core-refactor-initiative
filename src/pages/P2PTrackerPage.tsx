import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { computeFIFO, totalStock, getWACOP, stockCostQAR, type TrackerState } from '@/lib/tracker-helpers';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';
import '@/styles/tracker.css';

// ── Types ──
interface P2POffer {
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;
  completion: number;
}

interface P2PSnapshot {
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
  bestSell: number | null;
  bestBuy: number | null;
  spread: number | null;
  spreadPct: number | null;
  sellDepth: number;
  buyDepth: number;
  sellOffers: P2POffer[];
  buyOffers: P2POffer[];
}

interface P2PHistoryPoint {
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
  spread: number | null;
  spreadPct: number | null;
}

interface DaySummary {
  date: string;
  highSell: number;
  lowSell: number | null;
  highBuy: number;
  lowBuy: number | null;
  polls: number;
}

interface MerchantStat {
  nick: string;
  appearances: number;
  availabilityRatio: number;
  avgAvailable: number;
  maxAvailable: number;
}
type HistoryRow = {
  fetched_at: string | null;
  ts_val: string | number | null;
  sell_avg: string | number | null;
  buy_avg: string | number | null;
  spread_val: string | number | null;
  spread_pct_val: string | number | null;
};
type MerchantRow = {
  sell_offers: unknown;
  buy_offers: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractProjectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

function extractProjectRefFromPublishableKey(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as { ref?: unknown };
    return typeof payload.ref === 'string' ? payload.ref : null;
  } catch {
    return null;
  }
}

/** Time axis for chart/history rows: DB `fetched_at` only. Payload `data.ts` is fallback if row time is missing (never `Date.now()`). */
function historyRowTimestampMs(row: Pick<HistoryRow, 'fetched_at' | 'ts_val'>): number {
  if (row.fetched_at) {
    const ms = new Date(row.fetched_at).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  const raw = toFiniteNumber(row.ts_val);
  if (raw == null || !Number.isFinite(raw)) return NaN;
  const normalizedRaw = raw < 1e12 ? raw * 1000 : raw;
  return Number.isFinite(normalizedRaw) ? normalizedRaw : NaN;
}

/** Live snapshot cards: reconcile payload `ts` with `fetched_at` when drift is suspicious. */
function normalizeSnapshotTimestamp(rawTs: unknown, fetchedAt?: string): number {
  const fetchedAtMs = fetchedAt ? new Date(fetchedAt).getTime() : null;
  const hasValidFetchedAt = fetchedAtMs != null && Number.isFinite(fetchedAtMs);

  const raw = toFiniteNumber(rawTs);
  if (raw == null || !Number.isFinite(raw)) {
    return hasValidFetchedAt ? fetchedAtMs : Date.now();
  }

  const normalizedRaw = raw < 1e12 ? raw * 1000 : raw;
  if (!Number.isFinite(normalizedRaw)) {
    return hasValidFetchedAt ? fetchedAtMs : Date.now();
  }

  if (hasValidFetchedAt) {
    const driftMs = Math.abs(normalizedRaw - fetchedAtMs);
    const suspiciousDriftMs = 12 * 60 * 60 * 1000; // 12h
    if (driftMs > suspiciousDriftMs) {
      return fetchedAtMs;
    }
  }

  return normalizedRaw;
}

function simplifyMethod(m: string): string {
  const lower = m.toLowerCase();
  if (lower.includes('bank') || lower.includes('transfer') || lower.includes('iban') || lower.includes('wire') || lower.includes('swift') || lower.includes('sepa')) return 'Bank';
  return 'Cash';
}

function dedupeSimplified(methods: string[]): string[] {
  return [...new Set(methods.map(simplifyMethod))];
}

function toOffer(value: unknown): P2POffer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const price = toFiniteNumber(source.price);
  if (price === null) return null;
  return {
    price,
    min: toFiniteNumber(source.min) ?? 0,
    max: toFiniteNumber(source.max) ?? 0,
    nick: typeof source.nick === 'string' && source.nick.trim() ? source.nick : 'Unknown trader',
    methods: Array.isArray(source.methods)
      ? source.methods.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : [],
    available: toFiniteNumber(source.available) ?? 0,
    trades: toFiniteNumber(source.trades) ?? 0,
    completion: toFiniteNumber(source.completion) ?? 0,
  };
}

function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ts = normalizeSnapshotTimestamp(source.ts, fetchedAt);

  // Detect pre-fix data: if sellAvg < buyAvg, the data has sell/buy swapped
  const rawSellAvg = toFiniteNumber(source.sellAvg);
  const rawBuyAvg = toFiniteNumber(source.buyAvg);
  const isSwapped = rawSellAvg != null && rawBuyAvg != null && rawSellAvg < rawBuyAvg;

  const sellOffersRaw = Array.isArray(source.sellOffers) ? source.sellOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [];
  const buyOffersRaw = Array.isArray(source.buyOffers) ? source.buyOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [];

  if (isSwapped) {
    // Swap everything: old data had sell/buy reversed
    return {
      ts,
      sellAvg: rawBuyAvg,
      buyAvg: rawSellAvg,
      bestSell: toFiniteNumber(source.bestBuy),
      bestBuy: toFiniteNumber(source.bestSell),
      spread: rawBuyAvg != null && rawSellAvg != null ? rawBuyAvg - rawSellAvg : null,
      spreadPct: rawBuyAvg != null && rawSellAvg != null && rawSellAvg > 0 ? ((rawBuyAvg - rawSellAvg) / rawSellAvg) * 100 : null,
      sellDepth: toFiniteNumber(source.buyDepth) ?? 0,
      buyDepth: toFiniteNumber(source.sellDepth) ?? 0,
      sellOffers: buyOffersRaw.sort((a, b) => b.price - a.price),
      buyOffers: sellOffersRaw.sort((a, b) => a.price - b.price),
    };
  }

  return {
    ts,
    sellAvg: rawSellAvg,
    buyAvg: rawBuyAvg,
    bestSell: toFiniteNumber(source.bestSell),
    bestBuy: toFiniteNumber(source.bestBuy),
    spread: toFiniteNumber(source.spread),
    spreadPct: toFiniteNumber(source.spreadPct),
    sellDepth: toFiniteNumber(source.sellDepth) ?? 0,
    buyDepth: toFiniteNumber(source.buyDepth) ?? 0,
    sellOffers: sellOffersRaw,
    buyOffers: buyOffersRaw,
  };
}

// ── Markets ──
type MarketId = 'qatar' | 'uae' | 'egypt' | 'ksa' | 'turkey' | 'oman' | 'georgia' | 'kazakhstan';

const MARKETS: { id: MarketId; label: string; currency: string; pair: string }[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'uae', label: 'UAE', currency: 'AED', pair: 'USDT/AED' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'ksa', label: 'KSA', currency: 'SAR', pair: 'USDT/SAR' },
  { id: 'turkey', label: 'Turkey', currency: 'TRY', pair: 'USDT/TRY' },
  { id: 'oman', label: 'Oman', currency: 'OMR', pair: 'USDT/OMR' },
  { id: 'georgia', label: 'Georgia', currency: 'GEL', pair: 'USDT/GEL' },
  { id: 'kazakhstan', label: 'Kazakhstan', currency: 'KZT', pair: 'USDT/KZT' },
];

const EMPTY_SNAPSHOT: P2PSnapshot = {
  ts: Date.now(), sellAvg: null, buyAvg: null, bestSell: null, bestBuy: null,
  spread: null, spreadPct: null, sellDepth: 0, buyDepth: 0, sellOffers: [], buyOffers: [],
};

function computeDailySummaries(history: P2PHistoryPoint[]): DaySummary[] {
  const byDate = new Map<string, DaySummary>();
  for (const pt of history) {
    const date = format(new Date(pt.ts), 'yyyy-MM-dd');
    let day = byDate.get(date);
    if (!day) {
      day = { date, highSell: 0, lowSell: null, highBuy: 0, lowBuy: null, polls: 0 };
      byDate.set(date, day);
    }
    if (pt.sellAvg != null) {
      day.highSell = Math.max(day.highSell, pt.sellAvg);
      day.lowSell = day.lowSell === null ? pt.sellAvg : Math.min(day.lowSell, pt.sellAvg);
    }
    if (pt.buyAvg != null) {
      day.highBuy = Math.max(day.highBuy, pt.buyAvg);
      day.lowBuy = day.lowBuy === null ? pt.buyAvg : Math.min(day.lowBuy, pt.buyAvg);
    }
    day.polls++;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function formatOfferLimit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '∞';
  if (value >= 1_000_000) return `${fmtPrice(value / 1_000_000)}M`;
  if (value >= 1_000) return `${fmtTotal(value / 1_000)}K`;
  return fmtTotal(value);
}

function effectiveMax(offer: P2POffer): number {
  const availableFiat = offer.available * offer.price;
  if (offer.max > 0 && offer.max < availableFiat) return offer.max;
  return availableFiat;
}

// ── Component ──
export default function P2PTrackerPage() {
  const [market, setMarket] = useState<MarketId>('qatar');
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [latestFetchedAt, setLatestFetchedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');
  const [hoveredBar, setHoveredBar] = useState<{ type: 'sell' | 'buy'; index: number } | null>(null);
  const [qatarRates, setQatarRates] = useState<{ sellAvg: number; buyAvg: number } | null>(null);
  const [merchantStats, setMerchantStats] = useState<MerchantStat[]>([]);
  const t = useT();

  const currentMarket = MARKETS.find(m => m.id === market)!;
  const runtimeSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const runtimePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const runtimeProjectRefFromUrl = extractProjectRefFromUrl(runtimeSupabaseUrl);
  const runtimeProjectRefFromKey = extractProjectRefFromPublishableKey(runtimePublishableKey);

  const loadFromDb = useCallback(async () => {
    const { data: latestRow, error: latestError } = await supabase
      .from('p2p_snapshots')
      .select('*')
      .eq('market', market)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    if (latestRow?.data) {
      setSnapshot(toSnapshot(latestRow.data, latestRow.fetched_at));
      setLatestFetchedAt(latestRow.fetched_at ?? null);
    } else {
      setSnapshot(EMPTY_SNAPSHOT);
      setLatestFetchedAt(null);
    }

    // Fetch Qatar rates for cross-currency FX derivation
    if (market !== 'qatar') {
      const { data: qatarRow, error: qatarError } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', 'qatar')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qatarError) throw qatarError;
      if (qatarRow?.data) {
        const qSnap = toSnapshot(qatarRow.data, qatarRow.fetched_at);
        setQatarRates(qSnap.sellAvg != null && qSnap.buyAvg != null
          ? { sellAvg: qSnap.sellAvg, buyAvg: qSnap.buyAvg }
          : null);
      } else {
        setQatarRates(null);
      }
    } else {
      setQatarRates(null); // Not needed for Qatar
    }

    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    // Must take the *newest* rows first: ascending + limit only kept the oldest 5k rows, cutting off all
    // recent data when a market had >5k snapshots in the window (shows "0 pts · 24h" despite fresh DB rows).
    // @ts-ignore – deep type instantiation from jsonb->> selects
    const { data: histRowsDesc, error: historyError } = await supabase
      .from('p2p_snapshots')
      .select('fetched_at, ts_val:data->>ts, sell_avg:data->>sellAvg, buy_avg:data->>buyAvg, spread_val:data->>spread, spread_pct_val:data->>spreadPct')
      .eq('market', market)
      .gte('fetched_at', cutoff)
      .order('fetched_at', { ascending: false })
      .limit(10_000);
    if (historyError) throw historyError;

    const histRows = [...(histRowsDesc || [])].reverse();

    const historyPoints = (histRows as HistoryRow[]).flatMap((row) => {
      const ts = historyRowTimestampMs(row);
      if (!Number.isFinite(ts)) return [];
      return [{
        ts,
        sellAvg: toFiniteNumber(row.sell_avg),
        buyAvg: toFiniteNumber(row.buy_avg),
        spread: toFiniteNumber(row.spread_val),
        spreadPct: toFiniteNumber(row.spread_pct_val),
      }];
    });
    setHistory(historyPoints);

    const rowCount = histRows?.length ?? 0;
    const firstFetchedAt = rowCount > 0 ? histRows?.[0]?.fetched_at ?? 'n/a' : 'n/a';
    const lastFetchedAt = rowCount > 0 ? histRows?.[rowCount - 1]?.fetched_at ?? 'n/a' : 'n/a';
    const firstNormalizedTs = historyPoints.length > 0 ? new Date(historyPoints[0].ts).toISOString() : 'n/a';
    const lastNormalizedTs = historyPoints.length > 0 ? new Date(historyPoints[historyPoints.length - 1].ts).toISOString() : 'n/a';
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const final24hCount = historyPoints.filter(point => point.ts >= cutoff24h).length;

    const cutoff24hIso = new Date(cutoff24h).toISOString();
    // Newest-first + generous limit so dense cron (e.g. 1-min) still covers recent 24h; asc+500 missed latest polls.
    // @ts-ignore – deep type instantiation from jsonb-> selects
    const { data: merchantRowsDesc, error: merchantError } = await supabase
      .from('p2p_snapshots')
      .select('sell_offers:data->sellOffers, buy_offers:data->buyOffers')
      .eq('market', market)
      .gte('fetched_at', cutoff24hIso)
      .order('fetched_at', { ascending: false })
      .limit(2500);
    if (merchantError) throw merchantError;

    const rows = [...(merchantRowsDesc || [])].reverse() as MerchantRow[];
    const marketPolls = Math.max(rows.length, 1);
    const merchantMap = new Map<string, { appearances: number; totalAvailable: number; sampleCount: number; maxAvailable: number }>();

    for (const row of rows) {
      const seenInSnapshot = new Set<string>();
      const offersRaw = [
        ...(Array.isArray(row.sell_offers) ? row.sell_offers : []),
        ...(Array.isArray(row.buy_offers) ? row.buy_offers : []),
      ];
      const offers = offersRaw.map(toOffer).filter((offer): offer is P2POffer => offer !== null);

      for (const offer of offers) {
        const nick = offer.nick.trim();
        if (!nick) continue;
        let stat = merchantMap.get(nick);
        if (!stat) {
          stat = { appearances: 0, totalAvailable: 0, sampleCount: 0, maxAvailable: 0 };
          merchantMap.set(nick, stat);
        }
        if (!seenInSnapshot.has(nick)) {
          stat.appearances += 1;
          seenInSnapshot.add(nick);
        }
        stat.totalAvailable += offer.available;
        stat.sampleCount += 1;
        stat.maxAvailable = Math.max(stat.maxAvailable, offer.available);
      }
    }

    const computedMerchantStats = Array.from(merchantMap.entries())
      .map(([nick, stat]) => ({
        nick,
        appearances: stat.appearances,
        availabilityRatio: stat.appearances / marketPolls,
        avgAvailable: stat.sampleCount > 0 ? stat.totalAvailable / stat.sampleCount : 0,
        maxAvailable: stat.maxAvailable,
      }))
      .filter((stat) => stat.appearances > 0);
    setMerchantStats(computedMerchantStats);

    console.debug(
      `[P2P load] market=${market} rows=${rowCount} fetched_at=${firstFetchedAt}..${lastFetchedAt} normalized_ts=${firstNormalizedTs}..${lastNormalizedTs} last24h=${final24hCount}`,
    );
    console.debug(
      `[P2P runtime] market=${market} supabaseUrl=${runtimeSupabaseUrl ?? 'n/a'} ref(url)=${runtimeProjectRefFromUrl ?? 'n/a'} ref(key)=${runtimeProjectRefFromKey ?? 'n/a'} latestFetchedAt=${latestRow?.fetched_at ?? 'n/a'} historyRows=${historyPoints.length} last24hRows=${final24hCount}`,
    );
    setLastUpdate(new Date().toISOString());
  }, [market, runtimeSupabaseUrl, runtimeProjectRefFromUrl, runtimeProjectRefFromKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await loadFromDb();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load P2P data');
      setSnapshot(EMPTY_SNAPSHOT);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [loadFromDb]);

  // Initial load whenever market changes
  useEffect(() => { load(); }, [load]);

  // Realtime: re-read DB the moment the backend cron inserts a new snapshot
  useEffect(() => {
    const channel = supabase
      .channel(`p2p_snapshots_${market}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'p2p_snapshots', filter: `market=eq.${market}` },
        () => { void loadFromDb(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [market, loadFromDb]);

  // Tick every 30 s so the "data age" badge stays current
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const todaySummary = useMemo(() => {
    const todayStr = format(new Date(now), 'yyyy-MM-dd');
    const todayPts = history.filter(h => format(new Date(h.ts), 'yyyy-MM-dd') === todayStr);
    if (!todayPts.length) return null;
    const sellPresent = todayPts.filter(p => p.sellAvg != null);
    const buyPresent = todayPts.filter(p => p.buyAvg != null);
    return {
      highSell: sellPresent.length ? Math.max(...sellPresent.map(p => p.sellAvg!)) : null,
      lowSell: sellPresent.length ? Math.min(...sellPresent.map(p => p.sellAvg!)) : null,
      highBuy: buyPresent.length ? Math.max(...buyPresent.map(p => p.buyAvg!)) : null,
      lowBuy: buyPresent.length ? Math.min(...buyPresent.map(p => p.buyAvg!)) : null,
      polls: todayPts.length,
    };
  }, [history, now]);

  const last24hHistory = useMemo(() => {
    const cutoff = now - 24 * 60 * 60 * 1000;
    return history.filter(h => h.ts >= cutoff);
  }, [history, now]);

  const dailySummaries = useMemo(() => computeDailySummaries(history), [history]);
  const topAlwaysAvailableMerchants = useMemo(
    () => [...merchantStats]
      .sort((a, b) =>
        b.appearances - a.appearances ||
        b.availabilityRatio - a.availabilityRatio ||
        b.avgAvailable - a.avgAvailable,
      )
      .slice(0, 5),
    [merchantStats],
  );
  const topQuantityMerchants = useMemo(
    () => [...merchantStats]
      .sort((a, b) =>
        b.maxAvailable - a.maxAvailable ||
        b.avgAvailable - a.avgAvailable ||
        b.appearances - a.appearances,
      )
      .slice(0, 5),
    [merchantStats],
  );

  const filteredSummaries = useMemo(() => {
    const days = historyRange === '15d' ? 15 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailySummaries.filter(d => d.date >= cutoff);
  }, [dailySummaries, historyRange]);

  // Human-readable data freshness, recalculated every 30 s via `now`
  const dataAgeLabel = useMemo(() => {
    if (!latestFetchedAt) return null;
    const ageMs = now - new Date(latestFetchedAt).getTime();
    const ageSec = Math.floor(ageMs / 1000);
    if (ageSec < 60) return 'just now';
    const ageMin = Math.floor(ageSec / 60);
    if (ageMin < 60) return `${ageMin} min ago`;
    return `${Math.floor(ageMin / 60)}h ago`;
  }, [latestFetchedAt, now]);

  const sellAvg = snapshot?.sellAvg ?? 0;
  const buyAvg = snapshot?.buyAvg ?? 0;

  // ── FX helper: derive mid-rate from P2P data (market-driven FX proxy) ──
  const deriveMid = (s: number | null, b: number | null): number | null => {
    if (s != null && b != null && s > 0 && b > 0) return (s + b) / 2;
    return s ?? b ?? null;
  };

  const profitIfSold = useMemo(() => {
    try {
      const stateRaw = getCurrentTrackerState(localStorage);
      if (!stateRaw || !Array.isArray(stateRaw.batches) || !(stateRaw.batches as any[]).length) return null;
      const state = stateRaw as unknown as TrackerState;
      if (!state.batches?.length) return null;
      const derived = computeFIFO(state.batches, state.trades || []);
      const stock = totalStock(derived);
      if (stock <= 0) return null;
      const wacop = getWACOP(derived);
      const costBasis = stockCostQAR(derived);
      if (!wacop || wacop <= 0) return null;

      // FX source: derive mid-rate from P2P data for both local and QAR markets
      const localMid = deriveMid(sellAvg, buyAvg);
      const qatarMid = market === 'qatar'
        ? localMid
        : qatarRates ? deriveMid(qatarRates.sellAvg, qatarRates.buyAvg) : null;

      if (!localMid || localMid <= 0 || !qatarMid || qatarMid <= 0 || !sellAvg || sellAvg <= 0) {
        console.log(`[P2P Profit] Missing FX data: localMid=${localMid}, qatarMid=${qatarMid}, sellAvg=${sellAvg}`);
        return null;
      }

      // Explicit FX conversion path:
      // local->USD = 1 / localMid
      // QAR->USD = 1 / qatarMid
      // QAR->local = localMid / qatarMid
      const localToUsd = 1 / localMid;
      const qarToUsd = 1 / qatarMid;
      const qarToLocal = localMid / qatarMid;

      // Profit if sold now:
      // 1) costQAR (from FIFO cost basis)
      const costQAR = costBasis;
      // 2) costLocal = costQAR × FX(QAR->local)
      const costLocal = costQAR * qarToLocal;
      // 3) sellValueLocal = stockUSDT × sellAvgLocal
      const sellValueLocal = stock * sellAvg;
      // 4) profitLocal = sellValueLocal - costLocal
      const profitLocal = sellValueLocal - costLocal;
      // 5) profitUSD = profitLocal × FX(local->USD)
      const profitUSD = profitLocal * localToUsd;

      // Equivalent normalized values in USD for diagnostics/consistency
      const costBasisUSD = costQAR * qarToUsd;
      const sellValueUSD = sellValueLocal * localToUsd;

      return {
        stock,
        wacop,
        costQAR,
        costLocal,
        costBasisUSD,
        sellValueLocal,
        sellValueUSD,
        profitLocal,
        profit: profitUSD,
        fx: { localToUsd, qarToUsd, qarToLocal },
        currency: 'USD' as string,
      };
    } catch {
      return null;
    }
  }, [sellAvg, buyAvg, market, qatarRates]);

  // ── Round-trip market spread simulation (USD) ──
  const roundTripSim = useMemo(() => {
    if (!profitIfSold) return null;
    if (!sellAvg || !buyAvg || sellAvg <= 0 || buyAvg <= 0) return null;
    const { qarToLocal, localToUsd } = profitIfSold.fx;
    if (!qarToLocal || !localToUsd || qarToLocal <= 0 || localToUsd <= 0) return null;

    // Round-trip simulation:
    // 1) startingCostQAR = inventory cost basis in QAR
    const startingCostQAR = profitIfSold.costQAR;
    // 2) startingCapitalLocal = startingCostQAR × FX(QAR->local)
    const startingCapitalLocal = startingCostQAR * qarToLocal;
    if (startingCapitalLocal <= 0) return null;
    // 3) boughtUSDT = startingCapitalLocal / buyAvgLocal
    const boughtUSDT = startingCapitalLocal / buyAvg;
    // 4) finalLocal = boughtUSDT × sellAvgLocal
    const finalLocal = boughtUSDT * sellAvg;
    // 5) roundTripProfitLocal = finalLocal - startingCapitalLocal
    const roundTripProfitLocal = finalLocal - startingCapitalLocal;
    // 6) roundTripProfitUSD = roundTripProfitLocal × FX(local->USD)
    const profit = roundTripProfitLocal * localToUsd;
    // 7) percent on local starting capital
    const pct = (roundTripProfitLocal / startingCapitalLocal) * 100;

    return {
      startingCapitalLocal,
      startingCapitalUSD: startingCapitalLocal * localToUsd,
      finalLocal,
      finalUSD: finalLocal * localToUsd,
      boughtUSDT,
      profit,
      spreadRatio: sellAvg / buyAvg,
      pct,
    };
  }, [profitIfSold, sellAvg, buyAvg]);

  const priceBarData = useMemo(() => {
    if (!last24hHistory.length) return { sellBars: [], buyBars: [], sellValues: [], buyValues: [], sellLatest: 0, buyLatest: 0, sellChange: 0, buyChange: 0 };
    const sellPts = last24hHistory.filter(p => p.sellAvg != null).map(p => p.sellAvg!);
    const buyPts = last24hHistory.filter(p => p.buyAvg != null).map(p => p.buyAvg!);
    const sellLatest = sellPts.length ? sellPts[sellPts.length - 1] : 0;
    const buyLatest = buyPts.length ? buyPts[buyPts.length - 1] : 0;
    const sellFirst = sellPts.length ? sellPts[0] : sellLatest;
    const buyFirst = buyPts.length ? buyPts[0] : buyLatest;
    const sellChange = sellLatest - sellFirst;
    const buyChange = buyLatest - buyFirst;

    const numBars = 12;
    const makeBarArray = (pts: number[]) => {
      if (!pts.length) return Array(numBars).fill(0);
      const step = Math.max(1, Math.floor(pts.length / numBars));
      const bars: number[] = [];
      for (let i = 0; i < pts.length && bars.length < numBars; i += step) bars.push(pts[i]);
      while (bars.length < numBars) bars.push(pts[pts.length - 1]);
      return bars;
    };

    const sellMin = sellPts.length ? Math.min(...sellPts) : 0;
    const sellMax = sellPts.length ? Math.max(...sellPts) : 1;
    const buyMin = buyPts.length ? Math.min(...buyPts) : 0;
    const buyMax = buyPts.length ? Math.max(...buyPts) : 1;

    const normalize = (vals: number[], min: number, max: number) => {
      const range = max - min || 0.01;
      return vals.map(v => Math.max(5, ((v - min) / range) * 100));
    };

    const sellValues = makeBarArray(sellPts);
    const buyValues = makeBarArray(buyPts);

    return {
      sellBars: normalize(sellValues, sellMin, sellMax),
      buyBars: normalize(buyValues, buyMin, buyMax),
      sellValues,
      buyValues,
      sellLatest,
      buyLatest,
      sellChange,
      buyChange,
    };
  }, [last24hHistory]);

  const sellOffersMaxAvailable = useMemo(
    () => Math.max(...(snapshot?.sellOffers.map((offer) => offer.available) || [1])),
    [snapshot?.sellOffers],
  );
  const buyOffersMaxAvailable = useMemo(
    () => Math.max(...(snapshot?.buyOffers.map((offer) => offer.available) || [1])),
    [snapshot?.buyOffers],
  );

  const ccy = currentMarket.currency;

  if (loading && !snapshot) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-[250px] w-full" />
      </div>
    );
  }

  // No data yet for this market (brand-new market waiting for first backend sync)
  const hasNoData = !snapshot || (snapshot.sellAvg === null && snapshot.buyAvg === null && !history.length);

  if (!snapshot && !loading) return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={market} onValueChange={(v) => setMarket(v as MarketId)}>
          <TabsList>
            {MARKETS.map(m => (
              <TabsTrigger key={m.id} value={m.id} className="text-[11px] px-3">{m.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Badge variant="outline" className="font-mono text-[11px]">{currentMarket.pair}</Badge>
      </div>
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <span className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
        <p className="text-sm font-semibold text-muted-foreground">Collecting data for {currentMarket.label}…</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs">
          The backend sync runs every 5 minutes. First data point will appear automatically — no refresh needed.
        </p>
        <Button variant="outline" size="sm" onClick={() => load()} className="gap-1.5 h-8 text-[11px] mt-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Check now
        </Button>
      </div>
    </div>
  );

  if (!snapshot) return null;

  return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={market} onValueChange={(v) => setMarket(v as MarketId)}>
          <TabsList>
            {MARKETS.map(m => (
              <TabsTrigger key={m.id} value={m.id} className="text-[11px] px-3">{m.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} className="gap-1.5 h-8 text-[11px]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('p2pRefresh')}
        </Button>

        {/* Backend-driven sync indicator */}
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          {hasNoData ? 'Waiting for first sync…' : 'Backend sync · every 5 min'}
        </span>

        {dataAgeLabel && (
          <span className="text-[11px] text-muted-foreground">
            Data: {dataAgeLabel}
          </span>
        )}

        <Badge variant="outline" className="font-mono text-[11px]">{currentMarket.pair}</Badge>
      </div>

      <div className="tracker-root" style={{ background: 'transparent' }}>
        <div className="kpis" style={{ gridTemplateColumns: `repeat(${6 + (profitIfSold ? 1 : 0) + (roundTripSim ? 1 : 0)}, minmax(0, 1fr))` }}>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pBestSell')}</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
            <div className="kpi-sub">{t('p2pTopSell')} {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t(market === 'qatar' ? 'p2pSellAvgTop5' : 'p2pSellAvgTop10')}</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}</div>
            <div className="kpi-sub" style={{ color: 'var(--good)' }}>
              {snapshot.spreadPct ? `+${fmtPrice(snapshot.spreadPct)}% ${t('p2pSpreadLabel').toLowerCase()}` : t('p2pLiveWeightedAvg')}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pBestRestock')}</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestBuy ? fmtPrice(snapshot.bestBuy) : '—'}</div>
            <div className="kpi-sub">{t('p2pCheapestRestock')} {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pSpread')}</div>
            <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {snapshot.spread != null ? fmtPrice(snapshot.spread) : '—'}
            </div>
            <div className="kpi-sub">{snapshot.spreadPct != null ? `${fmtPrice(snapshot.spreadPct)}%` : t('p2pNoData')}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pTodayHighSell')}</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{todaySummary?.highSell ? fmtPrice(todaySummary.highSell) : '—'}</div>
            <div className="kpi-sub">{t('p2pLow')} {todaySummary?.lowSell ? fmtPrice(todaySummary.lowSell) : '—'} · {todaySummary?.polls || 0} {t('p2pPolls').toLowerCase()}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pTodayLowBuy')}</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{todaySummary?.lowBuy ? fmtPrice(todaySummary.lowBuy) : '—'}</div>
            <div className="kpi-sub">{t('p2pHigh')} {todaySummary?.highBuy ? fmtPrice(todaySummary.highBuy) : '—'}</div>
          </div>
          {profitIfSold && (
            <div className="kpi-card">
              <div className="kpi-lbl">{t('p2pProfitIfSoldNow')}</div>
              <div className="kpi-val" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {profitIfSold.profit >= 0 ? '+' : ''}${fmtTotal(profitIfSold.profit)}
              </div>
              <div className="kpi-sub">{fmtPrice(profitIfSold.stock)} USDT · {t('p2pCostBasis')}</div>
            </div>
          )}
          {roundTripSim && (
            <div className="kpi-card">
              <div className="kpi-lbl">Round-Trip Spread</div>
              <div className="kpi-val" style={{ color: roundTripSim.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {roundTripSim.profit >= 0 ? '+' : ''}${fmtTotal(roundTripSim.profit)}
              </div>
              <div className="kpi-sub">{fmtPrice(roundTripSim.pct)}% · sim</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '8px 12px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{t('p2pPriceHistory')}</h2>
            <span className="pill" style={{ fontSize: 9 }}>
              {last24hHistory.length} {t('p2pPts24h')}
              {dataAgeLabel && <> · {dataAgeLabel}</>}
            </span>
          </div>
          <div className="panel-body" style={{ padding: '8px 12px 12px', minHeight: 150, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">{t('p2pSellAvgLabel')}</span>
              <span className="font-mono text-[14px] font-extrabold" style={{ color: 'var(--good)' }}>{priceBarData.sellLatest ? fmtPrice(priceBarData.sellLatest) : '—'}</span>
            </div>
            <div className="flex items-end gap-1 h-5 relative">
              {priceBarData.sellBars.map((pct, i) => (
                <div
                  key={`sell-${i}`}
                  className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
                  style={{
                    height: `${Math.max(2, pct * 0.22)}px`,
                    background: hoveredBar?.type === 'sell' && hoveredBar.index === i
                      ? 'color-mix(in srgb, var(--good) 100%, transparent)'
                      : 'color-mix(in srgb, var(--good) 82%, transparent)',
                    transform: hoveredBar?.type === 'sell' && hoveredBar.index === i ? 'scaleY(1.3)' : 'scaleY(1)',
                    transformOrigin: 'bottom',
                  }}
                  onMouseEnter={() => setHoveredBar({ type: 'sell', index: i })}
                  onMouseLeave={() => setHoveredBar(null)}
                  title={priceBarData.sellValues[i] ? fmtPrice(priceBarData.sellValues[i]) : undefined}
                />
              ))}
              {hoveredBar?.type === 'sell' && priceBarData.sellValues[hoveredBar.index] != null && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[var(--good)] text-black text-[9px] font-bold px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10"
                  style={{ left: `${((hoveredBar.index + 0.5) / priceBarData.sellBars.length) * 100}%` }}>
                  {fmtPrice(priceBarData.sellValues[hoveredBar.index])}
                </div>
              )}
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">{t('p2pBuyAvgLabel')}</span>
              <span className="font-mono text-[14px] font-extrabold" style={{ color: 'var(--bad)' }}>{priceBarData.buyLatest ? fmtPrice(priceBarData.buyLatest) : '—'}</span>
            </div>
            <div className="flex items-end gap-1 h-5 relative">
              {priceBarData.buyBars.map((pct, i) => (
                <div
                  key={`buy-${i}`}
                  className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
                  style={{
                    height: `${Math.max(2, pct * 0.22)}px`,
                    background: hoveredBar?.type === 'buy' && hoveredBar.index === i
                      ? 'color-mix(in srgb, var(--bad) 100%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 82%, transparent)',
                    transform: hoveredBar?.type === 'buy' && hoveredBar.index === i ? 'scaleY(1.3)' : 'scaleY(1)',
                    transformOrigin: 'bottom',
                  }}
                  onMouseEnter={() => setHoveredBar({ type: 'buy', index: i })}
                  onMouseLeave={() => setHoveredBar(null)}
                  title={priceBarData.buyValues[i] ? fmtPrice(priceBarData.buyValues[i]) : undefined}
                />
              ))}
              {hoveredBar?.type === 'buy' && priceBarData.buyValues[hoveredBar.index] != null && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[var(--bad)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10"
                  style={{ left: `${((hoveredBar.index + 0.5) / priceBarData.buyBars.length) * 100}%` }}>
                  {fmtPrice(priceBarData.buyValues[hoveredBar.index])}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <span className="pill" style={{ fontSize: 9 }}>{t('sell')} {priceBarData.sellChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.sellChange)}</span>
              <span className="pill" style={{ fontSize: 9 }}>{t('buy')} {priceBarData.buyChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.buyChange)}</span>
            </div>
          </div>
        </div>

        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '8px 12px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              Merchant Depth Stats (24h)
            </h2>
            <span className="pill" style={{ fontSize: 9 }}>
              {merchantStats.length} tracked
            </span>
          </div>
          <div className="panel-body" style={{ padding: '8px 12px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted mb-2">Top 5 Always Available</div>
              {topAlwaysAvailableMerchants.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">No merchant data in last 24h.</div>
              ) : (
                <div className="space-y-1.5">
                  {topAlwaysAvailableMerchants.map((stat, idx) => (
                    <div key={`always-${stat.nick}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate">
                        <span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {Math.round(stat.availabilityRatio * 100)}% · {stat.appearances} polls
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted mb-2">Top 5 Biggest USDT Qty</div>
              {topQuantityMerchants.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">No merchant data in last 24h.</div>
              ) : (
                <div className="space-y-1.5">
                  {topQuantityMerchants.map((stat, idx) => (
                    <div key={`qty-${stat.nick}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate">
                        <span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        max {fmtTotal(stat.maxAvailable)} · avg {fmtTotal(stat.avgAvailable)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-2.5 px-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--good)' }}>
                <TrendingUp className="h-3 w-3" />
                {t('p2pSellOffers')}
              </CardTitle>
              <Badge className="text-[8px] px-1.5 py-0.5" style={{ background: 'hsl(var(--success, 142 76% 36%) / 0.15)', color: 'hsl(var(--success, 142 76% 36%))' }}>{t('p2pHighestFirst')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pTrader')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pPrice')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMin')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMax')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pMethods')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pTrades')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-center w-6">✓</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.sellOffers?.map((o, i) => {
                  const depthPct = sellOffersMaxAvailable > 0 ? Math.min(100, (o.available / sellOffersMaxAvailable) * 100) : 0;
                  return (
                    <TableRow key={`sell-${i}`} className="h-7">
                      <TableCell className="text-[11px] font-medium whitespace-nowrap py-1">
                        {i === 0 && <span className="text-yellow-500 mr-0.5">★</span>}{o.nick}
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1">
                          <span className="font-bold font-mono text-[11px]">{fmtPrice(o.price)}</span>
                          <div className="w-10 h-1 rounded bg-muted overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${depthPct}%`, background: 'hsl(var(--success, 142 76% 36%))' }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] py-1">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-[11px] py-1">{formatOfferLimit(effectiveMax(o))}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground py-1">{dedupeSimplified(o.methods).join(' ')}</TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">{o.trades > 0 ? o.trades.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-center py-1">
                        <span className="text-[12px]" style={{ color: 'hsl(var(--success, 142 76% 36%))' }}>✓</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.sellOffers?.length && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6 text-[10px]">{t('p2pNoSellOffers')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-2.5 px-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold flex items-center gap-1.5 text-destructive">
                <TrendingDown className="h-3 w-3" />
                {t('p2pRestockOffers')}
              </CardTitle>
              <Badge variant="destructive" className="text-[8px] px-1.5 py-0.5">{t('p2pCheapestFirst')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pTrader')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pPrice')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMin')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pMax')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold">{t('p2pMethods')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-right">{t('p2pTrades')}</TableHead>
                  <TableHead className="text-[9px] uppercase tracking-wider font-semibold text-center w-6">✓</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.buyOffers?.map((o, i) => {
                  const depthPct = buyOffersMaxAvailable > 0 ? Math.min(100, (o.available / buyOffersMaxAvailable) * 100) : 0;
                  return (
                    <TableRow key={`buy-${i}`} className="h-7">
                      <TableCell className="text-[11px] font-medium whitespace-nowrap py-1">
                        {i === 0 && <span className="text-yellow-500 mr-0.5">★</span>}{o.nick}
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1">
                          <span className="font-bold font-mono text-[11px]" style={{ color: 'hsl(var(--success, 142 76% 36%))' }}>{fmtPrice(o.price)}</span>
                          <div className="w-10 h-1 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-destructive/70 rounded" style={{ width: `${depthPct}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] py-1">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-[11px] py-1">{formatOfferLimit(effectiveMax(o))}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground py-1">{dedupeSimplified(o.methods).join(' ')}</TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-1">{o.trades > 0 ? o.trades.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-center py-1">
                        <span className="text-[12px] text-muted-foreground">—</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.buyOffers?.length && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6 text-[10px]">{t('p2pNoRestockOffers')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── Historical Averages (collapsible) ── */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowHistory(!showHistory)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
               {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
               {t('p2pHistoricalAverages')}
            </CardTitle>
            <div className="flex items-center gap-2">
              {showHistory && (
                <div className="flex gap-1">
                  <Button size="sm" variant={historyRange === '7d' ? 'default' : 'ghost'} onClick={e => { e.stopPropagation(); setHistoryRange('7d'); }}>7D</Button>
                  <Button size="sm" variant={historyRange === '15d' ? 'default' : 'ghost'} onClick={e => { e.stopPropagation(); setHistoryRange('15d'); }}>15D</Button>
                </div>
              )}
              <Badge variant="secondary" className="text-xs">{filteredSummaries.length} {t('p2pDays')}</Badge>
            </div>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>{t('date')}</TableHead>
                     <TableHead className="text-right">{t('p2pSellHigh')}</TableHead>
                     <TableHead className="text-right">{t('p2pSellLow')}</TableHead>
                     <TableHead className="text-right">{t('p2pSellAvg')}</TableHead>
                     <TableHead className="text-right">{t('p2pBuyHigh')}</TableHead>
                     <TableHead className="text-right">{t('p2pBuyLow')}</TableHead>
                     <TableHead className="text-right">{t('p2pBuyAvg')}</TableHead>
                     <TableHead className="text-right">{t('p2pSpreadLabel')}</TableHead>
                     <TableHead className="text-right">{t('p2pPolls')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummaries.map(d => {
                    const avgSell = (d.highSell + (d.lowSell ?? d.highSell)) / 2;
                    const avgBuy = (d.highBuy + (d.lowBuy ?? d.highBuy)) / 2;
                    const spread = avgSell - avgBuy;
                    return (
                      <TableRow key={d.date}>
                        <TableCell className="font-mono text-xs">{d.date}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-destructive">{fmtPrice(d.highSell)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-destructive/60">{d.lowSell != null ? fmtPrice(d.lowSell) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-destructive">{fmtPrice(avgSell)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-500">{fmtPrice(d.highBuy)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-500/60">{d.lowBuy != null ? fmtPrice(d.lowBuy) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-emerald-500">{fmtPrice(avgBuy)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-yellow-500">{fmtPrice(spread)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">{d.polls}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
