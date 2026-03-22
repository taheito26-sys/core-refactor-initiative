import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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

type CalcMode = 'sell' | 'buy' | 'target';

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
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');

  // Calculator
  const [calcMode, setCalcMode] = useState<CalcMode>('sell');
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

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => load(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  // ── Today's summary from history ──
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

  const priceBarData = useMemo(() => {
    const maxPoints = 80;
    const step = Math.max(1, Math.floor(last24hHistory.length / maxPoints));
    return last24hHistory.filter((_, i) => i % step === 0 || i === last24hHistory.length - 1);
  }, [last24hHistory]);

  const dailySummaries = useMemo(() => computeDailySummaries(history), [history]);

  const filteredSummaries = useMemo(() => {
    const days = historyRange === '15d' ? 15 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailySummaries.filter(d => d.date >= cutoff);
  }, [dailySummaries, historyRange]);

  const sellAvg = snapshot?.sellAvg ?? 0;
  const buyAvg = snapshot?.buyAvg ?? 0;

  const sellChange = useMemo(() => {
    if (last24hHistory.length < 2) return 0;
    const prev = last24hHistory[last24hHistory.length - 2];
    const curr = last24hHistory[last24hHistory.length - 1];
    return Math.round(((curr.sellAvg ?? 0) - (prev.sellAvg ?? 0)) * 1000) / 1000;
  }, [last24hHistory]);

  const buyChange = useMemo(() => {
    if (last24hHistory.length < 2) return 0;
    const prev = last24hHistory[last24hHistory.length - 2];
    const curr = last24hHistory[last24hHistory.length - 1];
    return Math.round(((curr.buyAvg ?? 0) - (prev.buyAvg ?? 0)) * 1000) / 1000;
  }, [last24hHistory]);

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
    return { qar: amt * rate, usdt: amt, rate };
  }, [calcAmount, calcRate, calcMode, sellAvg, buyAvg]);

  // ── Render ──
  if (loading && !snapshot) {
    return (
      <div className="tracker-root" style={{ padding: 10 }}>
        <div className="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <div className="empty-t">Loading P2P data…</div>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const ccy = currentMarket.currency;

  return (
    <div className="tracker-root" style={{ padding: 10 }}>
      {/* ── Status Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Market selector */}
        <div className="tracker-seg" style={{ marginRight: 4 }}>
          {MARKETS.map(m => (
            <button
              key={m.id}
              className={market === m.id ? 'active' : ''}
              onClick={() => { setMarket(m.id); setCalcRate(''); }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button className="btn" onClick={() => load(true)} disabled={loading} style={{ gap: 6 }}>
          <span>🔄</span> Refresh
        </button>
        {lastUpdate && (
          <span className="muted" style={{ fontSize: 11 }}>
            Updated {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}
        <span className="pill good" style={{ cursor: 'pointer' }} onClick={() => setAutoRefresh(!autoRefresh)}>
          ● {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
        </span>
        {snapshot.spread != null && snapshot.spreadPct != null && (
          <span className="pill warn">
            Spread {snapshot.spread.toFixed(3)} ({snapshot.spreadPct.toFixed(2)}%)
          </span>
        )}
        <span className="pill" style={{ fontWeight: 700 }}>{currentMarket.pair}</span>
      </div>

      {/* ── 6 KPI Cards ── */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', marginBottom: 10 }}>
        <div className="kpi-card">
          <div className="kpi-lbl">BEST SELL</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestSell?.toFixed(2) || '—'}</div>
          <div className="kpi-sub">Top offer {ccy}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">SELL AVG (TOP 5)</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.sellAvg?.toFixed(2) || '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--bad)' }}>
            {snapshot.sellAvg && snapshot.spreadPct ? `+${snapshot.spreadPct.toFixed(2)}% vs ${ccy} cost basis` : ''}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">BEST RESTOCK</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestBuy?.toFixed(2) || '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--good)' }}></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">SPREAD</div>
          <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
            {snapshot.spread != null ? `${snapshot.spread.toFixed(4)} ${ccy}` : '—'}
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

      {/* ── Price History + Position Info (2 col) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Price History — 24h */}
        <div className="panel">
          <div className="panel-head">
            <h2>📊 Price History</h2>
            <span className="pill">{last24hHistory.length} pts · 24h</span>
          </div>
          <div className="panel-body">
            {/* SELL AVG bars */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                SELL AVG
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: 28 }}>
                  {priceBarData.map((pt, i) => {
                    const vals = priceBarData.map(p => p.sellAvg ?? 0).filter(v => v > 0);
                    const minS = vals.length ? Math.min(...vals) : 0;
                    const maxS = vals.length ? Math.max(...vals) : 1;
                    const range = maxS - minS || 0.01;
                    const h = 6 + ((pt.sellAvg ?? minS) - minS) / range * 22;
                    return <div key={i} style={{ flex: 1, minWidth: 2, height: h, background: 'var(--bad)', borderRadius: 1, opacity: 0.8 }} />;
                  })}
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bad)', minWidth: 40, textAlign: 'right' }}>
                  {snapshot.sellAvg?.toFixed(1)}
                </span>
              </div>
            </div>
            {/* BUY AVG bars */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                BUY AVG
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: 28 }}>
                  {priceBarData.map((pt, i) => {
                    const vals = priceBarData.map(p => p.buyAvg ?? 0).filter(v => v > 0);
                    const minB = vals.length ? Math.min(...vals) : 0;
                    const maxB = vals.length ? Math.max(...vals) : 1;
                    const range = maxB - minB || 0.01;
                    const h = 6 + ((pt.buyAvg ?? minB) - minB) / range * 22;
                    return <div key={i} style={{ flex: 1, minWidth: 2, height: h, background: 'var(--good)', borderRadius: 1, opacity: 0.8 }} />;
                  })}
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--good)', minWidth: 40, textAlign: 'right' }}>
                  {snapshot.buyAvg?.toFixed(3)}
                </span>
              </div>
            </div>
            {/* Change badges */}
            <div style={{ display: 'flex', gap: 6 }}>
              <span className={`pill ${sellChange >= 0 ? 'bad' : 'good'}`}>
                Sell {sellChange >= 0 ? '+' : ''}{sellChange.toFixed(3)}
              </span>
              <span className={`pill ${buyChange <= 0 ? 'good' : 'bad'}`}>
                Buy {buyChange >= 0 ? '+' : ''}{buyChange.toFixed(3)}
              </span>
            </div>
          </div>
        </div>

        {/* Market Info */}
        <div className="panel">
          <div className="panel-head">
            <h2>📈 Market Info</h2>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--lt-radius-sm)', border: '1px solid var(--line)' }}>
              <span className="muted" style={{ fontSize: 11 }}>Sell Avg (Top 5)</span>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--bad)' }}>{sellAvg.toFixed(4)} {ccy}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--lt-radius-sm)', border: '1px solid var(--line)' }}>
              <span className="muted" style={{ fontSize: 11 }}>Buy Avg (Top 5)</span>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--good)' }}>{buyAvg.toFixed(4)} {ccy}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--lt-radius-sm)', border: '1px solid var(--line)' }}>
              <span className="muted" style={{ fontSize: 11 }}>Sell Depth</span>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{snapshot.sellDepth.toLocaleString()} USDT</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--lt-radius-sm)', border: '1px solid var(--line)' }}>
              <span className="muted" style={{ fontSize: 11 }}>Buy Depth</span>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{snapshot.buyDepth.toLocaleString()} USDT</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <button className="btn" style={{ justifyContent: 'center' }} onClick={() => { setCalcMode('sell'); setCalcRate(sellAvg.toFixed(2)); }}>
                Apply Sell Rate
              </button>
              <button className="btn secondary" style={{ justifyContent: 'center' }} onClick={() => { setCalcMode('buy'); setCalcRate(buyAvg.toFixed(2)); }}>
                Apply Buy Rate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sell Offers + Restock Offers (2 col) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Sell Offers */}
        <div className="panel">
          <div className="panel-head">
            <h2 style={{ color: 'var(--bad)' }}>↑ Sell Offers</h2>
            <span className="pill bad">Highest first</span>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>TRADER</th>
                    <th>PRICE</th>
                    <th>MIN</th>
                    <th>MAX</th>
                    <th>METHODS</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.sellOffers?.slice(0, 10).map((o, i) => {
                    const maxPrice = snapshot.sellOffers?.[0]?.price || 1;
                    const depthPct = Math.min(100, (o.price / maxPrice) * 100);
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, fontSize: 11 }}>
                          {i === 0 && '★ '}{o.nick}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 800, color: 'var(--bad)', fontSize: 12 }}>{o.price.toFixed(2)}</span>
                            <div style={{ width: 50, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                              <div style={{ width: `${depthPct}%`, height: '100%', background: 'var(--bad)', borderRadius: 3 }} />
                            </div>
                          </div>
                        </td>
                        <td className="mono r">{o.min > 0 ? o.min.toLocaleString() : '—'}</td>
                        <td className="mono r">{o.max > 0 ? o.max.toLocaleString() : '—'}</td>
                        <td style={{ fontSize: 10 }}>{o.methods.slice(0, 2).join('  ')}</td>
                      </tr>
                    );
                  })}
                  {(!snapshot.sellOffers?.length) && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)' }}>No sell offers available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Restock Offers */}
        <div className="panel">
          <div className="panel-head">
            <h2 style={{ color: 'var(--good)' }}>↓ Restock Offers</h2>
            <span className="pill good">Cheapest first</span>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>TRADER</th>
                    <th>PRICE</th>
                    <th>MIN</th>
                    <th>MAX</th>
                    <th>METHODS</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.buyOffers?.slice(0, 10).map((o, i) => {
                    const minPrice = snapshot.buyOffers?.[0]?.price || 1;
                    const maxP = snapshot.buyOffers?.[snapshot.buyOffers.length - 1]?.price || 1;
                    const range = maxP - minPrice || 0.01;
                    const depthPct = Math.min(100, ((o.price - minPrice) / range) * 100);
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, fontSize: 11 }}>
                          {i === 0 && '★ '}{o.nick}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 800, color: 'var(--good)', fontSize: 12 }}>{o.price.toFixed(2)}</span>
                            <div style={{ width: 50, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                              <div style={{ width: `${100 - depthPct}%`, height: '100%', background: 'var(--good)', borderRadius: 3 }} />
                            </div>
                          </div>
                        </td>
                        <td className="mono r">{o.min > 0 ? o.min.toLocaleString() : '—'}</td>
                        <td className="mono r">{o.max > 0 ? o.max.toLocaleString() : '—'}</td>
                        <td style={{ fontSize: 10 }}>{o.methods.slice(0, 2).join('  ')}</td>
                      </tr>
                    );
                  })}
                  {(!snapshot.buyOffers?.length) && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)' }}>No buy offers available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Calculator ── */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-head">
          <h2>🧮 Calculator</h2>
          <div className="modeToggle">
            <button className={calcMode === 'sell' ? 'active' : ''} onClick={() => { setCalcMode('sell'); setCalcRate(sellAvg.toFixed(2)); }}>Sell</button>
            <button className={calcMode === 'buy' ? 'active' : ''} onClick={() => { setCalcMode('buy'); setCalcRate(buyAvg.toFixed(2)); }}>Buy</button>
          </div>
        </div>
        <div className="panel-body">
          <div className="g2tight" style={{ marginBottom: 8 }}>
            <div className="field2">
              <span className="lbl">Amount (USDT)</span>
              <div className="inputBox">
                <input type="number" value={calcAmount} onChange={e => setCalcAmount(e.target.value)} placeholder="1000" />
              </div>
            </div>
            <div className="field2">
              <span className="lbl">Rate ({ccy})</span>
              <div className="inputBox">
                <input type="number" step="0.001" value={calcRate} onChange={e => setCalcRate(e.target.value)} placeholder="3.80" />
              </div>
            </div>
          </div>
          {calcResult && (
            <div className="bannerRow">
              <span className="bLbl">{calcMode === 'buy' ? 'Cost' : 'Revenue'}</span>
              <span className="bVal">{calcResult.qar.toFixed(2)} {ccy}</span>
              <span className="bSpacer" />
              <span className="bPill">@ {calcResult.rate.toFixed(3)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Historical Averages (collapsible) ── */}
      <div className="panel">
        <div className="panel-head" style={{ cursor: 'pointer' }} onClick={() => setShowHistory(!showHistory)}>
          <h2>📅 Historical Averages</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showHistory && (
              <div className="tracker-seg">
                <button className={historyRange === '7d' ? 'active' : ''} onClick={e => { e.stopPropagation(); setHistoryRange('7d'); }}>7D</button>
                <button className={historyRange === '15d' ? 'active' : ''} onClick={e => { e.stopPropagation(); setHistoryRange('15d'); }}>15D</button>
              </div>
            )}
            <span className="pill">{showHistory ? '▼' : '▶'} {filteredSummaries.length} days</span>
          </div>
        </div>
        {showHistory && (
          <div className="panel-body" style={{ padding: 0 }}>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>SELL HIGH</th>
                    <th>SELL LOW</th>
                    <th>SELL AVG</th>
                    <th>BUY HIGH</th>
                    <th>BUY LOW</th>
                    <th>BUY AVG</th>
                    <th>SPREAD</th>
                    <th>POLLS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummaries.map(d => {
                    const avgSell = (d.highSell + (d.lowSell ?? d.highSell)) / 2;
                    const avgBuy = (d.highBuy + (d.lowBuy ?? d.highBuy)) / 2;
                    const spread = avgSell - avgBuy;
                    return (
                      <tr key={d.date}>
                        <td className="mono">{d.date}</td>
                        <td className="mono r bad">{d.highSell.toFixed(3)}</td>
                        <td className="mono r" style={{ color: 'color-mix(in srgb, var(--bad) 60%, var(--muted))' }}>{d.lowSell?.toFixed(3) ?? '—'}</td>
                        <td className="mono r bad" style={{ fontWeight: 800 }}>{avgSell.toFixed(3)}</td>
                        <td className="mono r good">{d.highBuy.toFixed(3)}</td>
                        <td className="mono r" style={{ color: 'color-mix(in srgb, var(--good) 60%, var(--muted))' }}>{d.lowBuy?.toFixed(3) ?? '—'}</td>
                        <td className="mono r good" style={{ fontWeight: 800 }}>{avgBuy.toFixed(3)}</td>
                        <td className="mono r warn">{spread.toFixed(3)}</td>
                        <td className="mono r muted">{d.polls}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
