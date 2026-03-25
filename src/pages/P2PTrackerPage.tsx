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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  const ts = toFiniteNumber(source.ts) ?? (fetchedAt ? new Date(fetchedAt).getTime() : Date.now());

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
type MarketId = 'qatar' | 'uae' | 'egypt' | 'ksa' | 'syria' | 'turkey' | 'oman' | 'georgia' | 'uzbekistan';

const MARKETS: { id: MarketId; label: string; currency: string; pair: string }[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'uae', label: 'UAE', currency: 'AED', pair: 'USDT/AED' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'ksa', label: 'KSA', currency: 'SAR', pair: 'USDT/SAR' },
  { id: 'syria', label: 'Syria', currency: 'SYP', pair: 'USDT/SYP' },
  { id: 'turkey', label: 'Turkey', currency: 'TRY', pair: 'USDT/TRY' },
  { id: 'oman', label: 'Oman', currency: 'OMR', pair: 'USDT/OMR' },
  { id: 'georgia', label: 'Georgia', currency: 'GEL', pair: 'USDT/GEL' },
  { id: 'uzbekistan', label: 'Uzbekistan', currency: 'UZS', pair: 'USDT/UZS' },
];

const EMPTY_SNAPSHOT: P2PSnapshot = {
  ts: Date.now(), sellAvg: null, buyAvg: null, bestSell: null, bestBuy: null,
  spread: null, spreadPct: null, sellDepth: 0, buyDepth: 0, sellOffers: [], buyOffers: [],
};

function computeDailySummaries(history: P2PHistoryPoint[]): DaySummary[] {
  const byDate = new Map<string, DaySummary>();
  for (const pt of history) {
    const date = new Date(pt.ts).toISOString().slice(0, 10);
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [nextRefreshIn, setNextRefreshIn] = useState(300);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');
  const [hoveredBar, setHoveredBar] = useState<{ type: 'sell' | 'buy'; index: number } | null>(null);
  const t = useT();

  const currentMarket = MARKETS.find(m => m.id === market)!;

  const loadFromDb = useCallback(async () => {
    const { data: latestRow } = await supabase
      .from('p2p_snapshots')
      .select('*')
      .eq('market', market)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.data) {
      setSnapshot(toSnapshot(latestRow.data, latestRow.fetched_at));
    } else {
      setSnapshot(EMPTY_SNAPSHOT);
    }

    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const { data: histRows } = await supabase
      .from('p2p_snapshots')
      .select('data, fetched_at')
      .eq('market', market)
      .gte('fetched_at', cutoff)
      .order('fetched_at', { ascending: true });

    setHistory((histRows || []).map((row: any) => {
      const normalized = toSnapshot(row.data, row.fetched_at);
      return {
        ts: normalized.ts,
        sellAvg: normalized.sellAvg,
        buyAvg: normalized.buyAvg,
        spread: normalized.spread,
        spreadPct: normalized.spreadPct,
      };
    }));
    setLastUpdate(new Date().toISOString());
  }, [market]);

  const scrapeAndLoad = useCallback(async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      await fetch(`https://${projectId}.supabase.co/functions/v1/p2p-scraper?market=${market}`);
    } catch {
      console.warn('Scraper call failed, loading cached data');
    }
    await loadFromDb();
  }, [market, loadFromDb]);

  const load = useCallback(async (scrape = false) => {
    setLoading(true);
    try {
      if (scrape) await scrapeAndLoad();
      else await loadFromDb();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load P2P data');
      setSnapshot(EMPTY_SNAPSHOT);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [loadFromDb, scrapeAndLoad]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    setNextRefreshIn(300);
    const tick = setInterval(() => {
      setNextRefreshIn(prev => {
        if (prev <= 1) {
          load(true);
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh, load]);

  const todaySummary = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPts = history.filter(h => new Date(h.ts).toISOString().slice(0, 10) === todayStr);
    if (!todayPts.length) return null;
    return {
      highSell: Math.max(...todayPts.map(p => p.sellAvg ?? 0)),
      lowSell: Math.min(...todayPts.filter(p => p.sellAvg != null).map(p => p.sellAvg!)),
      highBuy: Math.max(...todayPts.map(p => p.buyAvg ?? 0)),
      lowBuy: Math.min(...todayPts.filter(p => p.buyAvg != null).map(p => p.buyAvg!)),
      polls: todayPts.length,
    };
  }, [history]);

  const last24hHistory = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return history.filter(h => h.ts >= cutoff);
  }, [history]);

  const dailySummaries = useMemo(() => computeDailySummaries(history), [history]);

  const filteredSummaries = useMemo(() => {
    const days = historyRange === '15d' ? 15 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailySummaries.filter(d => d.date >= cutoff);
  }, [dailySummaries, historyRange]);

  const sellAvg = snapshot?.sellAvg ?? 0;
  const buyAvg = snapshot?.buyAvg ?? 0;

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
      const revenue = stock * sellAvg;
      const profit = revenue - costBasis;
      return { stock, costBasis, wacop, profit };
    } catch {
      return null;
    }
  }, [sellAvg]);




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

        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading} className="gap-1.5 h-8 text-[11px]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('p2pRefresh')}
        </Button>

        <Button
          variant={autoRefresh ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="gap-1.5 h-8 text-[11px]"
        >
          <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
          {t('p2pAutoRefresh')}
        </Button>

        {lastUpdate && (
          <span className="text-[11px] text-muted-foreground">
            {t('p2pUpdated')} {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}

        <Badge variant="outline" className="font-mono text-[11px]">{currentMarket.pair}</Badge>
      </div>

      <div className="tracker-root" style={{ background: 'transparent' }}>
        <div className="kpis" style={{ gridTemplateColumns: profitIfSold ? 'repeat(7, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))' }}>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pBestSell')}</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
            <div className="kpi-sub">{t('p2pTopSell')} {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pSellAvgTop5')}</div>
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
                {profitIfSold.profit >= 0 ? '+' : ''}{fmtTotal(profitIfSold.profit)} {ccy}
              </div>
              <div className="kpi-sub">{fmtPrice(profitIfSold.stock)} USDT · {t('p2pCostBasis')}</div>
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
              {autoRefresh && <> · {Math.floor(nextRefreshIn / 60)}:{String(nextRefreshIn % 60).padStart(2, '0')}</>}
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
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>{t('p2pMarketInfo')}</h2>
            <span className="pill" style={{ fontSize: 9 }}>{currentMarket.pair}</span>
          </div>
          <div className="panel-body" style={{ padding: '0', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground">{t('p2pSellAvgTop5Label')}</span>
              <span className="font-mono text-[12px] font-extrabold" style={{ color: 'var(--good)' }}>{snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'} {ccy}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground">{t('p2pBuyAvgTop5Label')}</span>
              <span className="font-mono text-[12px] font-extrabold" style={{ color: 'var(--bad)' }}>{snapshot.buyAvg ? fmtPrice(snapshot.buyAvg) : '—'} {ccy}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground">{t('p2pSellDepth')}</span>
              <span className="font-mono text-[12px] font-extrabold text-muted-foreground">{snapshot.sellDepth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground">{t('p2pBuyDepth')}</span>
              <span className="font-mono text-[12px] font-extrabold text-muted-foreground">{snapshot.buyDepth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
            </div>
            {profitIfSold && (
              <div className="border-t border-[var(--line)] px-3 py-1.5">
                <div className="text-[10px] font-extrabold" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                  {profitIfSold.profit >= 0 ? '✓' : '✗'} {t('p2pProfitIfSoldLabel')}: {profitIfSold.profit >= 0 ? '+' : ''}{fmtTotal(profitIfSold.profit)} {ccy}
                </div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">
                  {fmtPrice(profitIfSold.stock)} USDT · WACOP {fmtPrice(profitIfSold.wacop)} {ccy}
                </div>
              </div>
            )}
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
