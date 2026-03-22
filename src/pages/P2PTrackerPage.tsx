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
import '@/styles/tracker.css';

// ── Types ──
interface P2POffer {
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
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
  };
}

function toSnapshot(value: unknown, fetchedAt?: string): P2PSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    ts: toFiniteNumber(source.ts) ?? (fetchedAt ? new Date(fetchedAt).getTime() : Date.now()),
    sellAvg: toFiniteNumber(source.sellAvg),
    buyAvg: toFiniteNumber(source.buyAvg),
    bestSell: toFiniteNumber(source.bestSell),
    bestBuy: toFiniteNumber(source.bestBuy),
    spread: toFiniteNumber(source.spread),
    spreadPct: toFiniteNumber(source.spreadPct),
    sellDepth: toFiniteNumber(source.sellDepth) ?? 0,
    buyDepth: toFiniteNumber(source.buyDepth) ?? 0,
    sellOffers: Array.isArray(source.sellOffers) ? source.sellOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [],
    buyOffers: Array.isArray(source.buyOffers) ? source.buyOffers.map(toOffer).filter((o): o is P2POffer => o !== null) : [],
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

type CalcMode = 'sell' | 'buy';

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
  const [calcMode, setCalcMode] = useState<CalcMode>('sell');
  const [calcAmount, setCalcAmount] = useState('1000');
  const [calcRate, setCalcRate] = useState('');

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

  // Calculator
  useEffect(() => {
    if (snapshot) {
      if (calcMode === 'sell' && !calcRate) setCalcRate(snapshot.sellAvg?.toFixed(2) || '');
      if (calcMode === 'buy' && !calcRate) setCalcRate(snapshot.buyAvg?.toFixed(2) || '');
    }
  }, [snapshot, calcMode, calcRate]);

  const calcResult = useMemo(() => {
    const amt = parseFloat(calcAmount) || 0;
    const rate = parseFloat(calcRate) || (calcMode === 'sell' ? sellAvg : buyAvg);
    if (!amt || !rate) return null;
    return { local: amt * rate, usdt: amt, rate };
  }, [calcAmount, calcRate, calcMode, sellAvg, buyAvg]);

  // Price history bar data
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

    // Create ~12 bars from history
    const numBars = 12;
    const makeBarArray = (pts: number[]) => {
      if (!pts.length) return Array(numBars).fill(0);
      const step = Math.max(1, Math.floor(pts.length / numBars));
      const bars: number[] = [];
      for (let i = 0; i < pts.length && bars.length < numBars; i += step) {
        bars.push(pts[i]);
      }
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

  const ccy = currentMarket.currency;

  // ── Loading state ──
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
    <div className="space-y-4 p-4">
      {/* ── Header: Market Tabs + Controls ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={market} onValueChange={(v) => { setMarket(v as MarketId); setCalcRate(''); }}>
          <TabsList>
            {MARKETS.map(m => (
              <TabsTrigger key={m.id} value={m.id} className="text-xs">{m.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>

        <Button
          variant={autoRefresh ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="gap-1.5 text-xs"
        >
          <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
          Auto-refresh
        </Button>

        {lastUpdate && (
          <span className="text-xs text-muted-foreground">
            Updated {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}

        <Badge variant="outline" className="font-mono text-xs">{currentMarket.pair}</Badge>
      </div>

      {/* ── KPI Cards (tracker.css – exact source repo sizing) ── */}
      <div className="tracker-root" style={{ background: 'transparent' }}>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <div className="kpi-card">
            <div className="kpi-lbl">BEST SELL</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestSell?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">Top offer {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">SELL AVG (TOP 5)</div>
            <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.sellAvg?.toFixed(2) || '—'}</div>
            <div className="kpi-sub" style={{ color: 'var(--bad)' }}>
              {snapshot.spreadPct ? `+${snapshot.spreadPct.toFixed(2)}% spread` : ''}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">BEST RESTOCK</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestBuy?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">Cheapest buy {ccy}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">SPREAD</div>
            <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {snapshot.spread != null ? `${snapshot.spread.toFixed(4)}` : '—'}
            </div>
            <div className="kpi-sub">{snapshot.spreadPct != null ? `${snapshot.spreadPct.toFixed(2)}%` : 'No data'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">TODAY HIGH SELL</div>
            <div className="kpi-val">{todaySummary?.highSell.toFixed(2) || '—'}</div>
            <div className="kpi-sub">
              Low {todaySummary?.lowSell?.toFixed(3) || '—'} · {todaySummary?.polls || 0} polls
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-lbl">TODAY LOW BUY</div>
            <div className="kpi-val" style={{ color: 'var(--good)' }}>{todaySummary?.lowBuy?.toFixed(2) || '—'}</div>
            <div className="kpi-sub">High {todaySummary?.highBuy?.toFixed(2) || '—'}</div>
          </div>
        </div>
      </div>

      {/* ── Price History + Market Info ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Price History Bars */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Price History
              </CardTitle>
              <Badge variant="secondary" className="text-xs">{last24hHistory.length} pts · 24h</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SELL AVG</div>
              <div className="flex items-end gap-1">
                {priceBarData.sellBars.map((pct, i) => (
                  <div key={i} className="flex-1 bg-destructive/80 rounded-sm" style={{ height: `${Math.max(3, pct * 0.24)}px` }} />
                ))}
                <span className="ml-2 font-bold font-mono text-base">{priceBarData.sellLatest ? priceBarData.sellLatest.toFixed(1) : '—'}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">BUY AVG</div>
              <div className="flex items-end gap-1">
                {priceBarData.buyBars.map((pct, i) => (
                  <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(3, pct * 0.24)}px`, background: 'hsl(var(--success, 142 76% 36%))' }} />
                ))}
                <span className="ml-2 font-bold font-mono text-base">{priceBarData.buyLatest ? priceBarData.buyLatest.toFixed(3) : '—'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className={`font-mono text-xs ${priceBarData.sellChange >= 0 ? 'text-destructive border-destructive/30' : ''}`}>
                Sell {priceBarData.sellChange >= 0 ? '+' : ''}{priceBarData.sellChange.toFixed(3)}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs" style={{ color: priceBarData.buyChange >= 0 ? 'hsl(var(--success, 142 76% 36%))' : undefined }}>
                Buy {priceBarData.buyChange >= 0 ? '+' : ''}{priceBarData.buyChange.toFixed(3)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Market Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-primary" />
              Market Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground">Sell Avg (Top 5)</span>
              <span className="font-bold font-mono text-sm text-destructive">{sellAvg.toFixed(4)} {ccy}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground">Buy Avg (Top 5)</span>
              <span className="font-bold font-mono text-sm" style={{ color: 'hsl(var(--success, 142 76% 36%))' }}>{buyAvg.toFixed(4)} {ccy}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground">Sell Depth</span>
              <span className="font-bold font-mono text-sm">{snapshot.sellDepth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground">Buy Depth</span>
              <span className="font-bold font-mono text-sm">{snapshot.buyDepth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button size="sm" variant="destructive" onClick={() => { setCalcMode('sell'); setCalcRate(sellAvg.toFixed(2)); }}>
                Apply Sell Rate
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setCalcMode('buy'); setCalcRate(buyAvg.toFixed(2)); }}>
                Apply Buy Rate
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Order Book: Sell + Buy ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-destructive" />
                Sell Offers
              </CardTitle>
              <Badge variant="destructive" className="text-xs">Highest first</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead>Methods</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.sellOffers?.map((o, i) => {
                  const maxAvail = Math.max(...(snapshot.sellOffers?.map(x => x.available) || [1]));
                  const depthPct = maxAvail > 0 ? Math.min(100, (o.available / maxAvail) * 100) : 0;
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium whitespace-nowrap">
                        {i === 0 && <span className="text-yellow-500 mr-1">★</span>}{o.nick}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-bold font-mono text-sm text-destructive">{o.price.toFixed(2)}</span>
                          <div className="w-10 h-1.5 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-destructive/70 rounded" style={{ width: `${depthPct}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{o.max > 0 ? o.max.toLocaleString() : '∞'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.methods.join(', ')}</TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.sellOffers?.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sell offers</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <TrendingDown className="h-4 w-4" style={{ color: 'hsl(var(--success, 142 76% 36%))' }} />
                Restock Offers
              </CardTitle>
              <Badge className="text-xs" style={{ background: 'hsl(var(--success, 142 76% 36%) / 0.15)', color: 'hsl(var(--success, 142 76% 36%))' }}>Cheapest first</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead>Methods</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.buyOffers?.map((o, i) => {
                  const maxAvail = Math.max(...(snapshot.buyOffers?.map(x => x.available) || [1]));
                  const depthPct = maxAvail > 0 ? Math.min(100, (o.available / maxAvail) * 100) : 0;
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium whitespace-nowrap">
                        {i === 0 && <span className="text-yellow-500 mr-1">★</span>}{o.nick}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-bold font-mono text-sm" style={{ color: 'hsl(var(--success, 142 76% 36%))' }}>{o.price.toFixed(2)}</span>
                          <div className="w-10 h-1.5 rounded bg-muted overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${depthPct}%`, background: 'hsl(var(--success, 142 76% 36%) / 0.7)' }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{o.min > 0 ? o.min.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{o.max > 0 ? o.max.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.methods.join(', ')}</TableCell>
                    </TableRow>
                  );
                })}
                {!snapshot.buyOffers?.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No buy offers</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Calculator
            </CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant={calcMode === 'sell' ? 'default' : 'ghost'} onClick={() => { setCalcMode('sell'); setCalcRate(sellAvg.toFixed(2)); }}>Sell</Button>
              <Button size="sm" variant={calcMode === 'buy' ? 'default' : 'ghost'} onClick={() => { setCalcMode('buy'); setCalcRate(buyAvg.toFixed(2)); }}>Buy</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount (USDT)</label>
              <Input type="number" value={calcAmount} onChange={e => setCalcAmount(e.target.value)} placeholder="1000" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rate ({ccy})</label>
              <Input type="number" step="0.001" value={calcRate} onChange={e => setCalcRate(e.target.value)} placeholder="3.80" />
            </div>
          </div>
          {calcResult && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/25 bg-primary/5">
              <span className="text-sm text-muted-foreground font-medium">{calcMode === 'buy' ? 'Cost' : 'Revenue'}</span>
              <span className="font-bold font-mono text-lg text-primary">{calcResult.local.toFixed(2)} {ccy}</span>
              <span className="flex-1" />
              <Badge variant="outline" className="font-mono">@ {calcResult.rate.toFixed(3)}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

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
