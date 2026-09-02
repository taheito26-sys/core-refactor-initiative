import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  DollarSign,
  Wallet,
  Clock,
  Layers,
  FileText,
  Building2,
  ArrowUpRight,
  ShieldCheck,
  Zap,
  Percent,
  Plus,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fmtU,
  fmtP,
  fmtTotal,
  fmtPct,
  type TrackerState,
} from '@/lib/tracker-helpers';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { TopClientsKPI } from '@/components/dashboard/TopClientsKPI';
import { BanqueMisrInstaPayKPI } from '@/components/dashboard/BanqueMisrInstaPayKPI';

export interface ModernDashboardViewProps {
  state: TrackerState;
  derived: any;
  dR: any;
  dM: any;
  d30: any;
  d7: any;
  stk: number;
  stCost: number;
  liveCashQAR: number;
  averageStockPrice: number;
  rLabel: string;
  baseFiat: 'QAR' | 'EGP';
  currency: 'QAR' | 'EGP' | 'USDT';
  qatarP2PRate: any;
  egyptP2PRate: any;
  loansUnpaid: any;
  avgM: number;
  activeAccounts: any[];
  accountBalances: Map<string, number>;
  t: (key: any) => string;
}

export function ModernDashboardView({
  state,
  derived,
  dR,
  stk,
  stCost,
  liveCashQAR,
  averageStockPrice,
  baseFiat,
  qatarP2PRate,
  egyptP2PRate,
  loansUnpaid,
  avgM,
  activeAccounts,
  accountBalances,
  t,
}: ModernDashboardViewProps) {
  const navigate = useNavigate();

  // Total Portfolio Capital (Cash in bank/safe + stock value)
  const totalPortfolioCapital = useMemo(() => {
    return liveCashQAR + stCost;
  }, [liveCashQAR, stCost]);

  // Chart data: daily aggregated volume and profit
  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; volume: number; profit: number; rawTs: number }>();
    const validTrades = (state.trades || []).filter((tr) => !tr.voided);

    validTrades.forEach((tr) => {
      const d = new Date(tr.ts);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      const calc = derived.tradeCalc?.get(tr.id);
      const prof = calc && calc.ok ? calc.profit : 0;

      const cur = map.get(key) || { date: key, volume: 0, profit: 0, rawTs: tr.ts };
      cur.volume += tr.usdt;
      cur.profit += prof;
      map.set(key, cur);
    });

    return Array.from(map.values())
      .sort((a, b) => a.rawTs - b.rawTs)
      .slice(-14);
  }, [state.trades, derived.tradeCalc]);

  return (
    <div className="w-full flex-1 flex flex-col gap-3 p-2.5 sm:p-4 bg-background text-foreground animate-in fade-in duration-150">
      
      {/* ── 1. HEADER & QUICK DESK ACTIONS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/70">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary flex-shrink-0" />
          <h1 className="text-base font-bold tracking-tight text-foreground">Executive Trading Desk Dashboard</h1>
          <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded">
            Live Liquidity
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/trading/stock')}
            className="px-2.5 py-1 rounded-lg bg-background hover:bg-muted border border-border text-[11px] font-semibold text-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Layers className="h-3 w-3 text-primary" />
            <span>Stock Desk</span>
          </button>
          <button
            onClick={() => navigate('/trading/orders')}
            className="px-3 py-1 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Orders Desk</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── 2. ULTRA-SLIM PRO METRIC RIBBON (Zero Wasted Space) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-muted/30 p-1 rounded-xl border border-border/70 text-xs">
        
        {/* Metric 1: Total Portfolio Capital */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-indigo-500/10 text-indigo-500 flex-shrink-0">
              <Wallet className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Portfolio Capital
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{fmtTotal(totalPortfolioCapital)}</span>
                <span className="text-[9px] text-muted-foreground font-semibold">{baseFiat}</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline">
            Cash + Stock
          </span>
        </div>

        {/* Metric 2: Realized Profit */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-emerald-500/10 text-emerald-500 flex-shrink-0">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Realized Profit
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-emerald-500 text-xs sm:text-sm">+{fmtTotal(dR.net)}</span>
                <span className="text-[9px] text-muted-foreground">{baseFiat}</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-emerald-500 font-semibold hidden xl:inline">
            Avg Mgn {avgM.toFixed(1)}%
          </span>
        </div>

        {/* Metric 3: Active Stock & WACOP */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-blue-500/10 text-blue-500 flex-shrink-0">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Active Stock
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{fmtU(stk)}</span>
                <span className="text-[9px] text-muted-foreground">USDT</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline">
            WACOP: {averageStockPrice > 0 ? fmtP(averageStockPrice) : '—'}
          </span>
        </div>

        {/* Metric 4: Cash Balances */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/80 border border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-amber-500/10 text-amber-500 flex-shrink-0">
              <Building2 className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                Liquid Cash
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{fmtTotal(liveCashQAR)}</span>
                <span className="text-[9px] text-muted-foreground">{baseFiat}</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground hidden xl:inline">
            {activeAccounts.length} Accounts
          </span>
        </div>

      </div>

      {/* ── 3. LIQUIDITY ACCOUNTS & LIVE P2P RATES ROW ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        
        {/* Cash Accounts Card */}
        <div className="rounded-xl border border-border/80 bg-card/60 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold text-foreground">Cash Accounts & Safe Liquidity</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-500 font-bold">
              Total: {fmtTotal(liveCashQAR)} {baseFiat}
            </span>
          </div>

          <div className="space-y-1.5 py-2">
            {activeAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active bank accounts found.</p>
            ) : (
              activeAccounts.slice(0, 4).map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-border/40 text-xs"
                >
                  <span className="font-medium text-foreground">{acc.name}</span>
                  <span className="font-mono font-bold text-foreground">
                    {fmtTotal(accountBalances.get(acc.id) || 0)} <span className="text-[9px] text-muted-foreground font-sans">{acc.currency}</span>
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => navigate('/trading/cash')}
            className="text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer pt-1 border-t border-border/40"
          >
            <span>Manage All Cash Accounts</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* P2P Benchmark Rates Card */}
        <div className="rounded-xl border border-border/80 bg-card/60 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-bold text-foreground">Live P2P Market Benchmarks</span>
            </div>
            <span className="text-[10px] text-muted-foreground">Updated Live</span>
          </div>

          <div className="space-y-2 py-2">
            {/* Qatar P2P */}
            <div className="p-2 rounded-lg bg-muted/40 border border-border/40 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-foreground">Qatar QAR/USDT</span>
                <p className="text-[10px] text-muted-foreground">Binance P2P Market</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-primary text-sm">
                  {qatarP2PRate?.buyRate ? fmtP(qatarP2PRate.buyRate) : '3.655'} QAR
                </span>
              </div>
            </div>

            {/* Egypt P2P */}
            <div className="p-2 rounded-lg bg-muted/40 border border-border/40 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-foreground">Egypt EGP/USDT</span>
                <p className="text-[10px] text-muted-foreground">Binance P2P Market</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-emerald-500 text-sm">
                  {egyptP2PRate?.buyRate ? fmtP(egyptP2PRate.buyRate) : '48.50'} EGP
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/trading/p2p')}
            className="text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer pt-1 border-t border-border/40"
          >
            <span>View Full P2P Rate Matrix</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

      </div>

      {/* ── 4. PERFORMANCE CHART & TOP CLIENTS ROW ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        
        {/* Trading Volume & Profit Chart */}
        <div className="lg:col-span-2 rounded-xl border border-border/80 bg-card/60 p-3 flex flex-col">
          <div className="flex items-center justify-between pb-2 border-b border-border/60 mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-bold text-foreground">14-Day Volume & Realized Profit Trend</span>
            </div>
          </div>

          <div className="h-48 w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No recent trading chart data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#94A3B8" fontSize={10} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      borderColor: 'rgba(51, 65, 85, 0.8)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Area type="monotone" dataKey="profit" stroke="#10B981" fillOpacity={1} fill="url(#profitGrad)" name="Profit (QAR)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top Counterparties / Clients */}
        <div className="rounded-xl border border-border/80 bg-card/60 p-3 flex flex-col">
          <div className="pb-2 border-b border-border/60 mb-2">
            <span className="text-xs font-bold text-foreground">Top Counterparties</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-48">
            {(state.customers || []).slice(0, 5).map((c, i) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                  <span className="font-semibold text-foreground">{c.name}</span>
                </div>
                <span className="px-1.5 py-0.2 rounded bg-primary/10 text-primary text-[9px] font-bold">
                  Tier {c.tier || 'C'}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
