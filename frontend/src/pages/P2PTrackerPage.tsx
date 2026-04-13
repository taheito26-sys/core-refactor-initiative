import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';

// ── New feature imports ────────────────────────────────────────────────────────
import { MARKETS } from '@/features/p2p/types';
import type { MarketId, P2PHistoryPoint } from '@/features/p2p/types';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import MarketKpiGrid from '@/features/p2p/components/MarketKpiGrid';
import PriceHistorySparklines from '@/features/p2p/components/PriceHistorySparklines';
import MerchantDepthStats from '@/features/p2p/components/MerchantDepthStats';
import P2POfferTable from '@/features/p2p/components/P2POfferTable';
import DeepScanResults from '@/features/p2p/components/DeepScanResults';

// ── Daily-summary helper ───────────────────────────────────────────────────────

interface DaySummary {
  date: string;
  highSell: number;
  lowSell: number | null;
  highBuy: number;
  lowBuy: number | null;
  polls: number;
}

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
      day.lowSell  = day.lowSell === null ? pt.sellAvg : Math.min(day.lowSell, pt.sellAvg);
    }
    if (pt.buyAvg != null) {
      day.highBuy = Math.max(day.highBuy, pt.buyAvg);
      day.lowBuy  = day.lowBuy === null ? pt.buyAvg : Math.min(day.lowBuy, pt.buyAvg);
    }
    day.polls++;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function P2PTrackerPage() {
  const [market, setMarket]           = useState<MarketId>('qatar');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [nextRefreshIn, setNextRefreshIn] = useState(300);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRange, setHistoryRange] = useState<'7d' | '15d'>('7d');
  const t = useT();

  const {
    snapshot,
    qatarSnapshot,
    history,
    last24hSnapshots,
    loading,
    error,
    refresh,
    lastUpdate,
  } = useP2PMarketData(market);

  const currentMarket = MARKETS.find(m => m.id === market)!;

  // Market change: reset timer
  const handleMarketChange = useCallback((v: string) => {
    setMarket(v as MarketId);
    setNextRefreshIn(300);
  }, []);

  // Manual refresh: trigger scraper then reload from DB
  const handleRefresh = useCallback(async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/p2p-scraper?market=${market}`,
      );
    } catch {
      // Scraper unavailable — will load cached data
    }
    refresh();
  }, [market, refresh]);

  // Auto-refresh countdown timer
  useEffect(() => {
    if (!autoRefresh) return;
    setNextRefreshIn(300);
    const tick = setInterval(() => {
      setNextRefreshIn(prev => {
        if (prev <= 1) {
          handleRefresh();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh, market, handleRefresh]);

  // Error toast
  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  // 24-h history slice for sparklines
  const last24hHistory = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return history.filter(h => h.ts >= cutoff);
  }, [history]);

  // Daily summaries for historical table
  const dailySummaries    = useMemo(() => computeDailySummaries(history), [history]);
  const filteredSummaries = useMemo(() => {
    const days   = historyRange === '15d' ? 15 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    return dailySummaries.filter(d => d.date >= cutoff);
  }, [dailySummaries, historyRange]);

  // Timer display
  const timerMin = Math.floor(nextRefreshIn / 60);
  const timerSec = String(nextRefreshIn % 60).padStart(2, '0');

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading && !snapshot.bestSell && !snapshot.sellAvg) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <Skeleton className="h-[170px]" />
          <Skeleton className="h-[170px]" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2 p-2 md:p-3">

      {/* ── Market Tabs + Controls ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={market} onValueChange={handleMarketChange}>
          <TabsList className="h-8">
            {MARKETS.map(m => (
              <TabsTrigger
                key={m.id}
                value={m.id}
                className="text-[11px] px-2 sm:px-3 h-7"
              >
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="gap-1.5 h-8 text-[11px]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>

        <Button
          variant={autoRefresh ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAutoRefresh(v => !v)}
          className="gap-1.5 h-8 text-[11px]"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              autoRefresh
                ? 'bg-green-400 animate-pulse'
                : 'bg-muted-foreground'
            }`}
          />
          {autoRefresh ? `Auto ${timerMin}:${timerSec}` : 'Auto-off'}
        </Button>

        {lastUpdate && (
          <span className="text-[11px] text-muted-foreground">
            {t('p2pUpdated')} {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}

        <Badge variant="outline" className="font-mono text-[11px]">
          {currentMarket.pair}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">5-min sync</Badge>
      </div>

      {/* ── KPI Grid (includes Egypt cross-rate row) ── */}
      <MarketKpiGrid
        market={market}
        snapshot={snapshot}
        qatarSnapshot={qatarSnapshot}
        history={history}
        currency={currentMarket.currency}
      />

      {/* ── Price History Sparklines + Merchant Depth ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <PriceHistorySparklines
          history={last24hHistory}
          nextRefreshIn={autoRefresh ? nextRefreshIn : null}
        />
        <MerchantDepthStats snapshots={last24hSnapshots} />
      </div>

      {/* ── Offer Tables ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <P2POfferTable
          offers={snapshot.sellOffers}
          side="sell"
          currency={currentMarket.currency}
        />
        <P2POfferTable
          offers={snapshot.buyOffers}
          side="buy"
          currency={currentMarket.currency}
        />
      </div>

      {/* ── Deep Market Scan ── */}
      <DeepScanResults
        offers={snapshot.buyOffers}
        currency={currentMarket.currency}
      />

      {/* ── Historical Averages (collapsible) ── */}
      <Card>
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setShowHistory(v => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              {showHistory
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
              {t('p2pHistoricalAverages')}
            </CardTitle>
            <div className="flex items-center gap-2">
              {showHistory && (
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant={historyRange === '7d' ? 'default' : 'ghost'}
                    className="h-6 text-[10px] px-2"
                    onClick={() => setHistoryRange('7d')}
                  >
                    7D
                  </Button>
                  <Button
                    size="sm"
                    variant={historyRange === '15d' ? 'default' : 'ghost'}
                    className="h-6 text-[10px] px-2"
                    onClick={() => setHistoryRange('15d')}
                  >
                    15D
                  </Button>
                </div>
              )}
              <Badge variant="secondary" className="text-xs">
                {filteredSummaries.length} {t('p2pDays')}
              </Badge>
            </div>
          </div>
        </CardHeader>

        {showHistory && (
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[380px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pSellHigh')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pSellLow')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pSellAvg')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pBuyHigh')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pBuyLow')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pBuyAvg')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pSpreadLabel')}</TableHead>
                    <TableHead className="text-right text-[10px]">{t('p2pPolls')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummaries.map(d => {
                    const avgSell = d.highSell > 0
                      ? (d.highSell + (d.lowSell ?? d.highSell)) / 2
                      : 0;
                    const avgBuy = d.highBuy > 0
                      ? (d.highBuy + (d.lowBuy ?? d.highBuy)) / 2
                      : 0;
                    const spread = avgSell - avgBuy;
                    return (
                      <TableRow key={d.date}>
                        <TableCell className="font-mono text-xs">{d.date}</TableCell>
                        <TableCell className="text-right font-mono text-xs" style={{ color: 'var(--good)' }}>
                          {d.highSell > 0 ? fmtPrice(d.highSell) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs opacity-60" style={{ color: 'var(--good)' }}>
                          {d.lowSell != null ? fmtPrice(d.lowSell) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold" style={{ color: 'var(--good)' }}>
                          {avgSell > 0 ? fmtPrice(avgSell) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs" style={{ color: 'var(--bad)' }}>
                          {d.highBuy > 0 ? fmtPrice(d.highBuy) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs opacity-60" style={{ color: 'var(--bad)' }}>
                          {d.lowBuy != null ? fmtPrice(d.lowBuy) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold" style={{ color: 'var(--bad)' }}>
                          {avgBuy > 0 ? fmtPrice(avgBuy) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-yellow-500">
                          {spread > 0 ? fmtPrice(spread) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {d.polls}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!filteredSummaries.length && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                        No data for the selected range
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
