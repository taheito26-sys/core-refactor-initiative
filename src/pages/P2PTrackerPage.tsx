import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, RefreshCw, Activity, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

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
      ? source.methods.filter((method): method is string => typeof method === 'string' && method.trim().length > 0)
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
    sellOffers: Array.isArray(source.sellOffers) ? source.sellOffers.map(toOffer).filter((offer): offer is P2POffer => offer !== null) : [],
    buyOffers: Array.isArray(source.buyOffers) ? source.buyOffers.map(toOffer).filter((offer): offer is P2POffer => offer !== null) : [],
  };
}

// ── Markets ──
type MarketId = 'qatar' | 'uae' | 'egypt' | 'ksa' | 'syria' | 'turkey';

const MARKETS: { id: MarketId; label: string; currency: string; currencySymbol: string }[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', currencySymbol: 'ق.ر' },
  { id: 'uae', label: 'UAE', currency: 'AED', currencySymbol: 'د.إ' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', currencySymbol: 'ج.م' },
  { id: 'ksa', label: 'KSA', currency: 'SAR', currencySymbol: 'ر.س' },
  { id: 'syria', label: 'Syria', currency: 'SYP', currencySymbol: 'ل.س' },
  { id: 'turkey', label: 'Turkey', currency: 'TRY', currencySymbol: '₺' },
];

// ── Helpers ──
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

const EMPTY_SNAPSHOT: P2PSnapshot = {
  ts: Date.now(), sellAvg: null, buyAvg: null, bestSell: null, bestBuy: null,
  spread: null, spreadPct: null, sellDepth: 0, buyDepth: 0, sellOffers: [], buyOffers: [],
};

// ── Component ──
export default function P2PTrackerPage() {
  const [market, setMarket] = useState<MarketId>('qatar');
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');

  // Calculator
  const [calcMode, setCalcMode] = useState<'sell' | 'buy'>('sell');
  const [calcAmount, setCalcAmount] = useState('1000');
  const [calcRate, setCalcRate] = useState('');

  const currentMarket = MARKETS.find(m => m.id === market)!;

  // ── Data Loading ──
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
      if (scrape) {
        await scrapeAndLoad();
      } else {
        await loadFromDb();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load P2P data');
      setSnapshot(EMPTY_SNAPSHOT);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [loadFromDb, scrapeAndLoad]);

  useEffect(() => {
    load(false);
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
    toast.success('Rates refreshed');
  };

  // ── Derived data ──
  const sellAvg = snapshot?.sellAvg ?? 0;
  const buyAvg = snapshot?.buyAvg ?? 0;
  const hasData = snapshot && (sellAvg > 0 || buyAvg > 0);

  const dailySummaries = useMemo(() => computeDailySummaries(history), [history]);
  const filteredSummaries = useMemo(() => {
    const days = historyRange === '15d' ? 15 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailySummaries.filter(d => d.date >= cutoff);
  }, [dailySummaries, historyRange]);

  // Calculator
  useEffect(() => {
    if (snapshot) {
      if (calcMode === 'sell' && snapshot.sellAvg) setCalcRate(snapshot.sellAvg.toFixed(4));
      if (calcMode === 'buy' && snapshot.buyAvg) setCalcRate(snapshot.buyAvg.toFixed(4));
    }
  }, [snapshot, calcMode]);

  const calcResult = useMemo(() => {
    const amt = parseFloat(calcAmount) || 0;
    const rate = parseFloat(calcRate) || 0;
    if (!amt || !rate) return null;
    return { localAmount: amt * rate, usdt: amt, rate };
  }, [calcAmount, calcRate]);

  // ── Price bar data (last 24h) ──
  const last24hHistory = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return history.filter(h => h.ts >= cutoff);
  }, [history]);

  const priceBarData = useMemo(() => {
    const maxPoints = 60;
    const step = Math.max(1, Math.floor(last24hHistory.length / maxPoints));
    return last24hHistory.filter((_, i) => i % step === 0 || i === last24hHistory.length - 1);
  }, [last24hHistory]);

  // ── Render ──
  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ccy = currentMarket.currency;

  return (
    <div className="space-y-4 p-4">
      {/* ── Market Tabs + Refresh ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {MARKETS.map(m => (
            <Button
              key={m.id}
              variant={market === m.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMarket(m.id); setCalcRate(''); }}
            >
              {m.label} ({m.currency})
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {lastUpdate && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(lastUpdate).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Rate Cards (Buy + Sell) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy USDT Card */}
        <Card className="border-green-500/30 bg-green-500/5 relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Buy USDT at
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-green-500">
                {hasData ? buyAvg.toFixed(4) : '—'}
              </span>
              <span className="text-sm text-muted-foreground">
                {currentMarket.currencySymbol}/USDT
              </span>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>Best: {snapshot?.bestBuy?.toFixed(4) ?? '—'}</span>
              <span>Depth: {snapshot?.buyDepth?.toLocaleString() ?? '0'} USDT</span>
            </div>
            <TrendingUp className="absolute right-4 bottom-4 h-16 w-16 text-green-500/10" />
          </CardContent>
        </Card>

        {/* Sell USDT Card */}
        <Card className="border-red-500/30 bg-red-500/5 relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sell USDT at
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-red-500">
                {hasData ? sellAvg.toFixed(4) : '—'}
              </span>
              <span className="text-sm text-muted-foreground">
                {currentMarket.currencySymbol}/USDT
              </span>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>Best: {snapshot?.bestSell?.toFixed(4) ?? '—'}</span>
              <span>Depth: {snapshot?.sellDepth?.toLocaleString() ?? '0'} USDT</span>
            </div>
            <TrendingDown className="absolute right-4 bottom-4 h-16 w-16 text-red-500/10" />
          </CardContent>
        </Card>
      </div>

      {/* ── Spread Info ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Spread</span>
              </div>
              <span className="text-lg font-bold">
                {snapshot?.spread != null ? snapshot.spread.toFixed(4) : '—'} {ccy}
              </span>
              <Badge variant={snapshot?.spreadPct != null && Math.abs(snapshot.spreadPct) < 2 ? 'default' : 'destructive'}>
                {snapshot?.spreadPct != null ? `${snapshot.spreadPct.toFixed(2)}%` : '—'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-500 border-green-500/30">
                <div className="h-2 w-2 rounded-full bg-green-500 mr-1 animate-pulse" />
                {hasData ? 'Live' : 'No data'}
              </Badge>
              <span className="text-xs text-muted-foreground">USDT/{ccy}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 24h Price Trend ── */}
      {priceBarData.length > 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              📊 24h Price Trend
              <Badge variant="outline">{last24hHistory.length} pts</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Sell bars */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">SELL AVG</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-end gap-[1px] h-7">
                    {priceBarData.map((pt, i) => {
                      const vals = priceBarData.map(p => p.sellAvg ?? 0).filter(v => v > 0);
                      const minS = Math.min(...vals); const maxS = Math.max(...vals);
                      const range = maxS - minS || 0.01;
                      const h = 4 + ((pt.sellAvg ?? minS) - minS) / range * 24;
                      return <div key={i} className="flex-1 min-w-[2px] rounded-sm bg-red-500/80" style={{ height: h }} />;
                    })}
                  </div>
                  <span className="text-sm font-bold text-red-500 min-w-[50px] text-right">
                    {sellAvg.toFixed(2)}
                  </span>
                </div>
              </div>
              {/* Buy bars */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">BUY AVG</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-end gap-[1px] h-7">
                    {priceBarData.map((pt, i) => {
                      const vals = priceBarData.map(p => p.buyAvg ?? 0).filter(v => v > 0);
                      const minB = Math.min(...vals); const maxB = Math.max(...vals);
                      const range = maxB - minB || 0.01;
                      const h = 4 + ((pt.buyAvg ?? minB) - minB) / range * 24;
                      return <div key={i} className="flex-1 min-w-[2px] rounded-sm bg-green-500/80" style={{ height: h }} />;
                    })}
                  </div>
                  <span className="text-sm font-bold text-green-500 min-w-[50px] text-right">
                    {buyAvg.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Order Book Preview ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy Orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-500 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Buy Orders (Top 10)
              <Badge variant="outline" className="text-green-500 border-green-500/30">
                Cheapest first
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-2 text-xs text-muted-foreground font-medium">Trader</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Price</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Min</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Max</th>
                    <th className="text-left p-2 text-xs text-muted-foreground font-medium">Methods</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.buyOffers ?? []).slice(0, 10).map((o, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="p-2 font-medium text-xs">
                        {i === 0 && <span className="text-yellow-500 mr-1">★</span>}
                        {o.nick}
                      </td>
                       <td className="p-2 text-right font-bold text-green-500">{o.price.toFixed(2)}</td>
                       <td className="p-2 text-right text-muted-foreground font-mono text-xs">{o.min > 0 ? o.min.toLocaleString() : '—'}</td>
                       <td className="p-2 text-right text-muted-foreground font-mono text-xs">{o.max > 0 ? o.max.toLocaleString() : '—'}</td>
                       <td className="p-2 text-xs text-muted-foreground">{o.methods.length ? o.methods.slice(0, 2).join(', ') : '—'}</td>
                    </tr>
                  ))}
                  {(!snapshot?.buyOffers?.length) && (
                    <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">No buy offers available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Sell Orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-500 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Sell Orders (Top 10)
              <Badge variant="outline" className="text-red-500 border-red-500/30">
                Highest first
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-2 text-xs text-muted-foreground font-medium">Trader</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Price</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Min</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Max</th>
                    <th className="text-left p-2 text-xs text-muted-foreground font-medium">Methods</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.sellOffers ?? []).slice(0, 10).map((o, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="p-2 font-medium text-xs">
                        {i === 0 && <span className="text-yellow-500 mr-1">★</span>}
                        {o.nick}
                      </td>
                       <td className="p-2 text-right font-bold text-red-500">{o.price.toFixed(2)}</td>
                       <td className="p-2 text-right text-muted-foreground font-mono text-xs">{o.min > 0 ? o.min.toLocaleString() : '—'}</td>
                       <td className="p-2 text-right text-muted-foreground font-mono text-xs">{o.max > 0 ? o.max.toLocaleString() : '—'}</td>
                       <td className="p-2 text-xs text-muted-foreground">{o.methods.length ? o.methods.slice(0, 2).join(', ') : '—'}</td>
                    </tr>
                  ))}
                  {(!snapshot?.sellOffers?.length) && (
                    <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">No sell offers available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Calculator ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            🧮 Calculator
            <div className="flex gap-1 ml-auto">
              <Button
                variant={calcMode === 'sell' ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => setCalcMode('sell')}
              >
                Sell
              </Button>
              <Button
                variant={calcMode === 'buy' ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => setCalcMode('buy')}
              >
                Buy
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Amount (USDT)</Label>
              <Input
                type="number"
                value={calcAmount}
                onChange={e => setCalcAmount(e.target.value)}
                placeholder="1000"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate ({ccy})</Label>
              <Input
                type="number"
                step="0.001"
                value={calcRate}
                onChange={e => setCalcRate(e.target.value)}
                placeholder="3.80"
              />
            </div>
          </div>
          {calcResult && (
            <div className="mt-3 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {calcMode === 'buy' ? 'Cost' : 'Revenue'}
              </span>
              <span className="text-lg font-bold">
                {calcResult.localAmount.toFixed(2)} {ccy}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Historical Averages (collapsible) ── */}
      <Card>
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setShowHistory(!showHistory)}
        >
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              📅 Historical Averages
            </span>
            <div className="flex items-center gap-2">
              {showHistory && (
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <Button
                    variant={historyRange === '7d' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setHistoryRange('7d')}
                  >
                    7D
                  </Button>
                  <Button
                    variant={historyRange === '15d' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setHistoryRange('15d')}
                  >
                    15D
                  </Button>
                </div>
              )}
              <Badge variant="outline">
                {showHistory ? '▼' : '▶'} {filteredSummaries.length} days
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>
        {showHistory && (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-2 text-xs text-muted-foreground font-medium">Date</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Sell High</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Sell Low</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Buy High</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Buy Low</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Spread</th>
                    <th className="text-right p-2 text-xs text-muted-foreground font-medium">Polls</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummaries.map(d => {
                    const avgSell = (d.highSell + (d.lowSell ?? d.highSell)) / 2;
                    const avgBuy = (d.highBuy + (d.lowBuy ?? d.highBuy)) / 2;
                    const spread = avgSell - avgBuy;
                    return (
                      <tr key={d.date} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-2 font-mono text-xs">{d.date}</td>
                        <td className="p-2 text-right font-mono text-xs text-red-500">{d.highSell.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs text-red-400/60">{d.lowSell?.toFixed(3) ?? '—'}</td>
                        <td className="p-2 text-right font-mono text-xs text-green-500">{d.highBuy.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs text-green-400/60">{d.lowBuy?.toFixed(3) ?? '—'}</td>
                        <td className="p-2 text-right font-mono text-xs text-yellow-500">{spread.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono text-xs text-muted-foreground">{d.polls}</td>
                      </tr>
                    );
                  })}
                  {filteredSummaries.length === 0 && (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground text-xs">No historical data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
