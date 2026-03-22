import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpDown, ChevronDown, ChevronRight, Calculator, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { computeFIFO, totalStock, getWACOP, stockCostQAR, type TrackerState } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
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
type MarketId = 'qatar' | 'uae' | 'egypt' | 'ksa' | 'syria' | 'turkey';

const MARKETS: { id: MarketId; label: string; currency: string; pair: string }[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'uae', label: 'UAE', currency: 'AED', pair: 'USDT/AED' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'ksa', label: 'KSA', currency: 'SAR', pair: 'USDT/SAR' },
  { id: 'syria', label: 'Syria', currency: 'SYP', pair: 'USDT/SYP' },
  { id: 'turkey', label: 'Turkey', currency: 'TRY', pair: 'USDT/TRY' },
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
  return value.toLocaleString();
}

// ── Component ──
export default function P2PTrackerPage() {
  const [market, setMarket] = useState<MarketId>('qatar');
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');
  const [targetMargin, setTargetMargin] = useState('2');

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
    const interval = setInterval(() => load(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
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

  const targetMarginValue = Math.max(0, parseFloat(targetMargin) || 0);

  const advisor = useMemo(() => {
    if (!profitIfSold) return null;
    const targetPrice = profitIfSold.wacop * (1 + targetMarginValue / 100);
    return {
      avgPrice: profitIfSold.wacop,
      targetPrice,
      sellReady: sellAvg >= targetPrice,
      restockAboveCost: buyAvg > profitIfSold.wacop,
    };
  }, [profitIfSold, targetMarginValue, sellAvg, buyAvg]);

  const priceBarData = useMemo(() => {
    if (!last24hHistory.length) return { sellBars: [], buyBars: [], sellLatest: 0, buyLatest: 0, sellChange: 0, buyChange: 0 };
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

    return {
      sellBars: normalize(makeBarArray(sellPts), sellMin, sellMax),
      buyBars: normalize(makeBarArray(buyPts), buyMin, buyMax),
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
          Refresh
        </Button>

        <Button
          variant={autoRefresh ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="gap-1.5 h-8 text-[11px]"
        >
          <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
          Auto-refresh
        </Button>

        {lastUpdate && (
          <span className="text-[11px] text-muted-foreground">
            Updated {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}

        <Badge variant="outline" className="font-mono text-[11px]">{currentMarket.pair}</Badge>
      </div>

      <div className="tracker-root" style={{ background: 'transparent' }}>
        <div className="kpis" style={{ gridTemplateColumns: profitIfSold ? 'repeat(7, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))' }}>
          <div className="kpi-card">
            <div className="kpi-lbl">BEST SELL</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">Top sell {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">SELL AVG (TOP 5)</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.sellAvg?.toFixed(2) || '—'}</div>
            <div className="kpi-sub" style={{ color: 'var(--good)' }}>
              {snapshot.spreadPct ? `+${snapshot.spreadPct.toFixed(2)}% spread` : 'Live weighted average'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">BEST RESTOCK</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestBuy?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">Cheapest restock {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">SPREAD</div>
            <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {snapshot.spread != null ? snapshot.spread.toFixed(4) : '—'}
            </div>
            <div className="kpi-sub">{snapshot.spreadPct != null ? `${snapshot.spreadPct.toFixed(2)}%` : 'No data'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">TODAY HIGH SELL</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{todaySummary?.highSell.toFixed(2) || '—'}</div>
            <div className="kpi-sub">Low {todaySummary?.lowSell?.toFixed(3) || '—'} · {todaySummary?.polls || 0} polls</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">TODAY LOW BUY</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{todaySummary?.lowBuy?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">High {todaySummary?.highBuy?.toFixed(2) || '—'}</div>
          </div>
          {profitIfSold && (
            <div className="kpi-card">
              <div className="kpi-lbl">PROFIT IF SOLD NOW</div>
              <div className="kpi-val" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {profitIfSold.profit >= 0 ? '+' : ''}{profitIfSold.profit.toFixed(0)} {ccy}
              </div>
              <div className="kpi-sub">{profitIfSold.stock.toFixed(3)} USDT · cost basis</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '10px 14px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📊 Price History</h2>
            <span className="pill">{last24hHistory.length} pts · 24h</span>
          </div>
          <div className="panel-body" style={{ padding: '14px 18px 18px', minHeight: 220, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-extrabold tracking-[0.14em] uppercase muted">Sell Avg</span>
              <span className="font-mono text-[18px] font-extrabold" style={{ color: 'var(--good)' }}>{priceBarData.sellLatest ? priceBarData.sellLatest.toFixed(3) : '—'}</span>
            </div>
            <div className="flex items-end gap-1 h-10">
              {priceBarData.sellBars.map((pct, i) => (
                <div key={`sell-${i}`} className="flex-1 rounded-sm" style={{ height: `${Math.max(3, pct * 0.32)}px`, background: 'color-mix(in srgb, var(--good) 82%, transparent)' }} />
              ))}
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-extrabold tracking-[0.14em] uppercase muted">Buy Avg</span>
              <span className="font-mono text-[18px] font-extrabold" style={{ color: 'var(--bad)' }}>{priceBarData.buyLatest ? priceBarData.buyLatest.toFixed(3) : '—'}</span>
            </div>
            <div className="flex items-end gap-1 h-10">
              {priceBarData.buyBars.map((pct, i) => (
                <div key={`buy-${i}`} className="flex-1 rounded-sm" style={{ height: `${Math.max(3, pct * 0.32)}px`, background: 'color-mix(in srgb, var(--bad) 82%, transparent)' }} />
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <span className="pill">Sell {priceBarData.sellChange >= 0 ? '+' : ''}{priceBarData.sellChange.toFixed(3)}</span>
              <span className="pill">Buy {priceBarData.buyChange >= 0 ? '+' : ''}{priceBarData.buyChange.toFixed(3)}</span>
            </div>
          </div>
        </div>

        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '10px 14px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🎯 Position Advisor</h2>
            <span className="pill good">Computed from real data</span>
          </div>
          <div className="panel-body" style={{ padding: '14px 18px 18px', minHeight: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-[var(--panel2)] px-4 py-3">
              <span className="text-[13px] text-muted-foreground">Your Av Price</span>
              <span className="font-mono text-[16px] font-extrabold">{advisor ? `${advisor.avgPrice.toFixed(4)} ${ccy}` : '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-[var(--panel2)] px-4 py-3 gap-4">
              <span className="text-[13px] text-muted-foreground">Target margin (manual %)</span>
              <Input
                type="number"
                step="0.1"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
                className="h-8 w-20 text-right font-mono"
              />
            </div>
            <div className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-[var(--panel2)] px-4 py-3">
              <span className="text-[13px] text-muted-foreground">Target price ({targetMarginValue}% margin)</span>
              <span className="font-mono text-[16px] font-extrabold" style={{ color: 'var(--good)' }}>{advisor ? `${advisor.targetPrice.toFixed(5)} ${ccy}` : '—'}</span>
            </div>
            <div className="rounded-[8px] border px-4 py-3" style={{ borderColor: 'color-mix(in srgb, var(--good) 45%, transparent)', background: 'color-mix(in srgb, var(--good) 12%, transparent)' }}>
              <div className="text-[13px] font-extrabold" style={{ color: 'var(--good)' }}>
                {advisor?.sellReady ? '✓ Good time to sell' : '• Wait for better sell price'}
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {advisor ? `Sell avg ${sellAvg.toFixed(3)} ${advisor.sellReady ? '≥' : '<'} target ${advisor.targetPrice.toFixed(5)}` : 'Import stock data to enable advice'}
              </div>
            </div>
            <div className="rounded-[8px] border px-4 py-3" style={{ borderColor: 'color-mix(in srgb, var(--warn) 45%, transparent)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>
              <div className="text-[13px] font-extrabold" style={{ color: 'var(--warn)' }}>
                {advisor?.restockAboveCost ? '⚠ Restock above avg cost' : '✓ Restock below avg cost'}
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {advisor ? (advisor.restockAboveCost ? 'Would raise avg cost' : 'Would improve cost basis') : 'Import stock data to enable advice'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '10px 14px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--good)' }}>↑ Sell Offers</h2>
            <span className="pill good">Highest first · ✓ fits your stock</span>
          </div>
          <div className="tableWrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[25%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Trader</TableHead>
                  <TableHead className="w-[18%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Price</TableHead>
                  <TableHead className="w-[14%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-right">Min</TableHead>
                  <TableHead className="w-[14%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-right">Max</TableHead>
                  <TableHead className="w-[23%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Methods</TableHead>
                  <TableHead className="w-[6%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-center">✓</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.sellOffers?.map((o, i) => {
                  const depthPct = sellOffersMaxAvailable > 0 ? Math.min(100, (o.available / sellOffersMaxAvailable) * 100) : 0;
                  return (
                    <TableRow key={`sell-offer-${i}`}>
                      <TableCell className="py-3 text-[12px] font-extrabold whitespace-normal break-words leading-tight">
                        {i === 0 && <span className="mr-1 text-yellow-400">★</span>}
                        {o.nick}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-extrabold" style={{ color: 'var(--good)' }}>{o.price.toFixed(2)}</span>
                          <div className="h-1.5 flex-1 rounded-full" style={{ background: 'var(--line2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${depthPct}%`, background: 'var(--good)' }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-[12px]">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-[12px]">{formatOfferLimit(o.max)}</TableCell>
                      <TableCell className="py-3 text-[11px] text-muted-foreground whitespace-normal break-words leading-tight">{o.methods.join(' ') || '—'}</TableCell>
                      <TableCell className="py-3 text-center text-[14px]" style={{ color: 'var(--good)' }}>✓</TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.sellOffers?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No sell offers</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="tracker-root panel">
          <div className="panel-head" style={{ padding: '10px 14px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--bad)' }}>↓ Restock Offers</h2>
            <span className="pill bad">Cheapest first</span>
          </div>
          <div className="tableWrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[25%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Trader</TableHead>
                  <TableHead className="w-[18%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Price</TableHead>
                  <TableHead className="w-[14%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-right">Min</TableHead>
                  <TableHead className="w-[14%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-right">Max</TableHead>
                  <TableHead className="w-[23%] text-[10px] uppercase tracking-[0.16em] font-extrabold">Methods</TableHead>
                  <TableHead className="w-[6%] text-[10px] uppercase tracking-[0.16em] font-extrabold text-center">✓</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.buyOffers?.map((o, i) => {
                  const depthPct = buyOffersMaxAvailable > 0 ? Math.min(100, (o.available / buyOffersMaxAvailable) * 100) : 0;
                  return (
                    <TableRow key={`buy-offer-${i}`}>
                      <TableCell className="py-3 text-[12px] font-extrabold whitespace-normal break-words leading-tight">
                        {i === 0 && <span className="mr-1 text-yellow-400">★</span>}
                        {o.nick}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-extrabold" style={{ color: 'var(--bad)' }}>{o.price.toFixed(2)}</span>
                          <div className="h-1.5 flex-1 rounded-full" style={{ background: 'var(--line2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${depthPct}%`, background: 'var(--bad)' }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-[12px]">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-[12px]">{formatOfferLimit(o.max)}</TableCell>
                      <TableCell className="py-3 text-[11px] text-muted-foreground whitespace-normal break-words leading-tight">{o.methods.join(' ') || '—'}</TableCell>
                      <TableCell className="py-3 text-center text-[14px] text-muted-foreground">—</TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.buyOffers?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No restock offers</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Historical Averages (collapsible) ── */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowHistory(!showHistory)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Historical Averages
            </CardTitle>
            <div className="flex items-center gap-2">
              {showHistory && (
                <div className="flex gap-1">
                  <Button size="sm" variant={historyRange === '7d' ? 'default' : 'ghost'} onClick={e => { e.stopPropagation(); setHistoryRange('7d'); }}>7D</Button>
                  <Button size="sm" variant={historyRange === '15d' ? 'default' : 'ghost'} onClick={e => { e.stopPropagation(); setHistoryRange('15d'); }}>15D</Button>
                </div>
              )}
              <Badge variant="secondary" className="text-xs">{filteredSummaries.length} days</Badge>
            </div>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Sell High</TableHead>
                    <TableHead className="text-right">Sell Low</TableHead>
                    <TableHead className="text-right">Sell Avg</TableHead>
                    <TableHead className="text-right">Buy High</TableHead>
                    <TableHead className="text-right">Buy Low</TableHead>
                    <TableHead className="text-right">Buy Avg</TableHead>
                    <TableHead className="text-right">Spread</TableHead>
                    <TableHead className="text-right">Polls</TableHead>
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
                        <TableCell className="text-right font-mono text-xs text-destructive">{d.highSell.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-destructive/60">{d.lowSell?.toFixed(3) ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-destructive">{avgSell.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-500">{d.highBuy.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-500/60">{d.lowBuy?.toFixed(3) ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-emerald-500">{avgBuy.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-yellow-500">{spread.toFixed(3)}</TableCell>
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
