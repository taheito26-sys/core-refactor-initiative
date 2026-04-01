import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtQWithUnit, fmtU, fmtQ, fmtPct, fmtP,
  fmtTotal, fmtPrice,
  kpiFor, totalStock, stockCostQAR, getWACOP,
  rangeLabel, num, startOfDay,
  deriveCashQAR,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useQuery } from '@tanstack/react-query';
import { CashBoxManager } from '@/features/dashboard/components/CashBoxManager';
import { buildDealRowModel } from '@/features/orders/utils/dealRowModel';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import '@/styles/tracker.css';

interface DashboardPageProps {
  adminUserId?: string;
  adminMerchantId?: string;
  adminTrackerState?: any;
  isAdminView?: boolean;
}

export default function DashboardPage({ adminUserId, adminMerchantId, adminTrackerState, isAdminView }: DashboardPageProps = {}) {
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
    preloadedState: adminTrackerState || undefined,
  });

  const dM = kpiFor(state, derived, 'this_month');
  const dL = kpiFor(state, derived, 'last_month');
  const d1 = kpiFor(state, derived, 'today');
  const d7 = kpiFor(state, derived, '7d');
  const d30 = kpiFor(state, derived, '30d');
  const dR = kpiFor(state, derived, settings.range);
  const stk = totalStock(derived);
  const stCost = stockCostQAR(derived);
  const wacop = getWACOP(derived);
  const rLabel = rangeLabel(settings.range);

  const allTrades = state.trades.filter(t => !t.voided);
  const allMargins = allTrades.map(tr => {
    const c = derived.tradeCalc.get(tr.id);
    if (!c?.ok) return null;
    // For linked trades, adjust margin to reflect only my share
    if (tr.linkedDealId || tr.linkedRelId) {
      const myPct = tr.merchantPct ?? 100;
      const myNet = c.netQAR * myPct / 100;
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      return rev > 0 ? (myNet / rev) * 100 : 0;
    }
    return c.margin;
  }).filter((x): x is number => x !== null);
  const avgM = allMargins.length ? allMargins.reduce((s, v) => s + v, 0) / allMargins.length : 0;

  // Avg cycle time: hours from batch purchase to FIFO sell
  const cycleHours = useMemo(() => {
    const tradesSorted = [...allTrades].sort((a, b) => a.ts - b.ts);
    const deltas: number[] = [];
    for (const tr of tradesSorted) {
      const c = derived.tradeCalc.get(tr.id);
      if (!c?.ok || !c.slices?.length) continue;
      for (const sl of c.slices) {
        const batch = state.batches.find(b => b.id === sl.batchId);
        if (batch) {
          const delta = (tr.ts - batch.ts) / (1000 * 60 * 60);
          if (delta > 0 && delta < 10000) deltas.push(delta);
        }
      }
    }
    return deltas.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : null;
  }, [allTrades, derived, state.batches]);

  const LOW = num(state.settings?.lowStockThreshold, 5000);
  const isLow = stk <= 0 || (LOW > 0 && stk < LOW);

  const [showCashBox, setShowCashBox] = useState(false);
  const [expandedNewKpi, setExpandedNewKpi] = useState<string | null>(null);
  const [roiPeriod, setRoiPeriod] = useState<'7d' | '30d'>('7d');
  const { user, merchantProfile } = useAuth();
  const userId = adminUserId || user?.id;
  const workspaceMerchantId = adminMerchantId || merchantProfile?.merchant_id;

  // Merchant deals KPIs
  interface DealDetail {
    id: string;
    title: string;
    merchantName: string;
    net: number;
    myShare: number;
    partnerShare: number;
    vol: number;
    status: string;
    direction: 'outgoing' | 'incoming';
    dealType: string;
  }

  const { data: merchantDealKpis } = useQuery({
    queryKey: ['dashboard-merchant-deals', userId, workspaceMerchantId],
    staleTime: 15_000,       // re-fetch after 15 s so edits in Orders page show quickly
    refetchInterval: 30_000, // poll every 30 s in background
    queryFn: async () => {
      if (!userId || !workspaceMerchantId) return null;
      const relsScopedRes = await supabase
        .from('merchant_relationships')
        .select('id, merchant_a_id, merchant_b_id')
        .eq('status', 'active')
        .or(`merchant_a_id.eq.${workspaceMerchantId},merchant_b_id.eq.${workspaceMerchantId}`);
      if (relsScopedRes.error) throw relsScopedRes.error;
      const relIds = (relsScopedRes.data || []).map(r => r.id);
      const { data: deals } = relIds.length > 0
        ? await supabase
            .from('merchant_deals')
            .select('id, amount, status, created_by, notes, deal_type, relationship_id, title')
            .in('relationship_id', relIds)
            .order('created_at', { ascending: false })
        : { data: [] as any[] };
      if (!deals || deals.length === 0) return null;

      const activeDeals = deals.filter(d => d.status !== 'cancelled' && d.status !== 'voided');
      // Fetch merchant profiles for names
      const dealRelIds = [...new Set(activeDeals.map(d => d.relationship_id))];
      const { data: rels } = dealRelIds.length > 0
        ? await supabase.from('merchant_relationships').select('id, merchant_a_id, merchant_b_id').in('id', dealRelIds)
        : { data: [] as any[] };

      const allMerchantIds = new Set<string>();
      for (const r of (rels || [])) { allMerchantIds.add(r.merchant_a_id); allMerchantIds.add(r.merchant_b_id); }

      const { data: profiles } = allMerchantIds.size > 0
        ? await supabase.from('merchant_profiles').select('merchant_id, display_name, user_id').in('merchant_id', [...allMerchantIds])
        : { data: [] as any[] };

      const profileMap = new Map<string, { name: string; userId: string }>();
      for (const p of (profiles || [])) profileMap.set(p.merchant_id, { name: p.display_name, userId: p.user_id });

      const relMap = new Map<string, { merchant_a_id: string; merchant_b_id: string }>();
      for (const r of (rels || [])) relMap.set(r.id, r);

      let outCount = 0, outVol = 0, outNet = 0;
      let inCount = 0, inVol = 0, inNet = 0;
      let pendingCount = 0, approvedCount = 0;
      let totalMyShare = 0, totalPartnerShare = 0;
      const dealDetails: DealDetail[] = [];

      for (const d of activeDeals) {
        const direction = d.created_by === userId ? 'outgoing' as const : 'incoming' as const;
        const row = buildDealRowModel({
          deal: d,
          perspective: direction,
          locale: t.isRTL ? 'ar' : 'en',
        });
        const vol = row.volume;
        const dealNet = row.fullNet ?? 0;
        const myShare = direction === 'outgoing' ? (row.creatorNet ?? 0) : (row.partnerNet ?? 0);
        const partnerShare = direction === 'outgoing' ? (row.partnerNet ?? 0) : (row.creatorNet ?? 0);

        if (d.status === 'pending') pendingCount++;
        if (d.status === 'approved') approvedCount++;

        const rel = relMap.get(d.relationship_id);
        let merchantName = 'Unknown';
        if (rel) {
          const myProfile = [...profileMap.values()].find(p => p.userId === userId);
          const myMerchantId = myProfile ? [...profileMap.entries()].find(([, v]) => v.userId === userId)?.[0] : null;
          const counterId = myMerchantId === rel.merchant_a_id ? rel.merchant_b_id : rel.merchant_a_id;
          merchantName = profileMap.get(counterId)?.name || 'Unknown';
        }

        if (direction === 'outgoing') {
          outCount++; outVol += vol; outNet += dealNet;
        } else {
          inCount++; inVol += vol; inNet += dealNet;
        }

        totalMyShare += myShare;
        totalPartnerShare += partnerShare;

        dealDetails.push({
          id: d.id,
          title: d.title,
          merchantName,
          net: Math.round(dealNet * 100) / 100,
          myShare: Math.round(myShare * 100) / 100,
          partnerShare: Math.round(partnerShare * 100) / 100,
          vol: Math.round(vol * 100) / 100,
          status: d.status,
          direction,
          dealType: d.deal_type,
        });
      }

      return {
        totalDeals: activeDeals.length,
        outCount, outVol, outNet,
        inCount, inVol, inNet,
        pendingCount, approvedCount,
        totalVol: outVol + inVol,
        totalNet: outNet + inNet,
        totalMyShare, totalPartnerShare,
        dealDetails,
      };
    },
    enabled: !!userId && !!workspaceMerchantId,
  });

  const handleCashSave = useCallback((newCash: number, owner: string, history?: import('@/lib/tracker-helpers').CashTransaction[]) => {
    applyState({ ...state, cashQAR: newCash, cashOwner: owner, cashHistory: history ?? state.cashHistory ?? [] });
  }, [state, applyState]);


  // ── P2P Averages from real trade data ──
  const p2pAvgs = useMemo(() => {
    const sellTrades = allTrades.filter(t => t.usesStock && t.sellPriceQAR > 0);
    const avgSell = sellTrades.length ? sellTrades.reduce((s, t) => s + t.sellPriceQAR, 0) / sellTrades.length : null;
    // Avg buy from batches
    const batches = state.batches.filter(b => b.buyPriceQAR > 0);
    const avgBuy = batches.length ? batches.reduce((s, b) => s + b.buyPriceQAR, 0) / batches.length : null;
    return { avgSell, avgBuy };
  }, [allTrades, state.batches]);

  // Helper: get net P&L for a trade (FIFO or manual fallback) — applies "my cut" for linked trades
  const tradeNet = (tr: typeof allTrades[0]) => {
    const c = derived.tradeCalc.get(tr.id);
    let fullNet = 0;
    if (c?.ok) fullNet = c.netQAR;
    else if (tr.manualBuyPrice) fullNet = tr.amountUSDT * tr.sellPriceQAR - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR;
    // For linked trades, show only my share
    if (tr.linkedDealId || tr.linkedRelId) {
      const myPct = tr.merchantPct ?? 100;
      return fullNet * myPct / 100;
    }
    return fullNet;
  };

  // ── Chart 1: Profit & Revenue Trend (last 14 trades) ──
  const trendData = useMemo(() => {
    const sorted = [...allTrades].sort((a, b) => a.ts - b.ts).slice(-14);
    return sorted.map((tr, i) => {
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      return {
        idx: i + 1,
        date: new Date(tr.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        revenue: Math.round(rev),
        profit: Math.round(tradeNet(tr)),
      };
    });
  }, [allTrades, derived]);

  // ── Chart 2: Net Profit Per Trade (all time, bar chart) ──
  const profitPerTradeData = useMemo(() => {
    const sorted = [...allTrades].sort((a, b) => a.ts - b.ts);
    return sorted.map((tr, i) => {
      const net = tradeNet(tr);
      return {
        idx: i + 1,
        profit: Math.round(net),
        positive: net >= 0,
      };
    });
  }, [allTrades, derived]);

  // ── Chart 3: Daily Volume & Profit (aggregated by day) ──
  const dailyData = useMemo(() => {
    const dayMap = new Map<number, { vol: number; profit: number; count: number }>();
    for (const tr of allTrades) {
      const dayTs = startOfDay(tr.ts);
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      const net = tradeNet(tr);
      const existing = dayMap.get(dayTs) || { vol: 0, profit: 0, count: 0 };
      existing.vol += rev;
      existing.profit += net;
      existing.count += 1;
      dayMap.set(dayTs, existing);
    }
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a - b)
      .slice(-14)
      .map(([ts, d]) => ({
        date: new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        volume: Math.round(d.vol),
        profit: Math.round(d.profit),
        trades: d.count,
      }));
  }, [allTrades, derived]);

  // ── Recharts custom tooltip ──
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: 'var(--panel2)', border: '1px solid var(--line)',
        borderRadius: 6, padding: '6px 10px', fontSize: 10,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
        {payload.map((p: any, i: number) => (
          <div key={i} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <span>{p.name}</span>
            <span className="mono" style={{ fontWeight: 700 }}>{fmtTotal(Number(p.value))} QAR</span>
          </div>
        ))}
      </div>
    );
  };

  const badgeStyle = (condition: string) => {
    const color = condition === 'good' ? 'var(--good)' : condition === 'bad' ? 'var(--bad)' : 'var(--warn)';
    return {
      color,
      borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
    };
  };

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      {/* KPI Bands */}
      <div className="kpi-band-grid">
        <div className="kpi-band">
          <div className="kpi-band-title">{t('tradingVolume')}</div>
          <div className="kpi-band-cols">
            <div>
              <div className="kpi-period">{t('thisMonth')}</div>
              <div className="kpi-cell-val t1v">{fmtQWithUnit(dM.rev)}</div>
              <div className="kpi-cell-sub">{dM.count} {t('trades')} · {fmtU(dM.qty, 0)} USDT</div>
            </div>
            <div>
              <div className="kpi-period">{t('lastMonth')}</div>
              <div className="kpi-cell-val t1v">{fmtQWithUnit(dL.rev)}</div>
              <div className="kpi-cell-sub">{dL.count} {t('trades')} · {fmtU(dL.qty, 0)} USDT</div>
            </div>
          </div>
        </div>
        <div className="kpi-band">
          <div className="kpi-band-title">{t('netProfit')}</div>
          <div className="kpi-band-cols">
            <div>
              <div className="kpi-period">{t('thisMonth')}</div>
              <div className={`kpi-cell-val ${dM.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dM.net)}</div>
              <div className="kpi-cell-sub">{t('fees')} {fmtQWithUnit(dM.fee)}</div>
              <div className="kpi-cell-sub" style={{ fontSize: 8, marginTop: 2 }}>📤 {t('myDealsLabel')}</div>
            </div>
            <div>
              <div className="kpi-period">{t('lastMonth')}</div>
              <div className={`kpi-cell-val ${dL.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dL.net)}</div>
              <div className="kpi-cell-sub">{t('fees')} {fmtQWithUnit(dL.fee)}</div>
              <div className="kpi-cell-sub" style={{ fontSize: 8, marginTop: 2 }}>📤 {t('myDealsLabel')}</div>
            </div>
          </div>
          {/* Incoming deals net profit */}
          {merchantDealKpis && merchantDealKpis.inCount > 0 && (
            <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 6, background: 'color-mix(in srgb, var(--good) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 15%, transparent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)' }}>📥 {t('incomingDealsLabel')} ({merchantDealKpis.inCount})</span>
                <span className={`mono ${merchantDealKpis.inNet >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 12, fontWeight: 800 }}>
                  {merchantDealKpis.inNet >= 0 ? '+' : ''}{fmtQWithUnit(merchantDealKpis.inNet)}
                </span>
              </div>
              <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>
                {t('myCutLabel')}: {fmtQWithUnit(merchantDealKpis.dealDetails.filter(d => d.direction === 'incoming').reduce((s, d) => s + d.myShare, 0))}
              </div>
            </div>
          )}
          {/* Combined total */}
          {merchantDealKpis && merchantDealKpis.inCount > 0 && (
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.5px' }}>📊 {t('combinedTotal')}</span>
              <span className={`mono ${(dR.net + merchantDealKpis.inNet) >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 13, fontWeight: 800 }}>
                {(dR.net + merchantDealKpis.inNet) >= 0 ? '+' : ''}{fmtQWithUnit(dR.net + merchantDealKpis.inNet)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards Row 1 */}
      <div className="kpis">
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(dR.net >= 0 ? 'good' : 'bad')}>{rLabel}</span>
          </div>
          <div className="kpi-lbl">{t('netProfitLabel')}</div>
          <div className={`kpi-val ${dR.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dR.net)}</div>
          <div className="kpi-sub">{dR.count} {t('trades')} · {fmtQ(dR.rev)} {t('revSuffix')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(avgM >= 1 ? 'good' : avgM >= 0 ? 'warn' : 'bad')}>{allTrades.length} {t('trades')}</span>
          </div>
          <div className="kpi-lbl">{t('avgMargin')}</div>
          <div className={`kpi-val ${avgM >= 1 ? 'good' : avgM >= 0 ? 'warn' : 'bad'}`}>{fmtPct(avgM)}</div>
          <div className="kpi-sub">{dR.count} in range · avg {fmtPct(dR.avgMgn)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(isLow ? 'bad' : 'good')}>{isLow ? t('low') : t('ok')}</span>
          </div>
          <div className="kpi-lbl">{t('availableUsdt')}</div>
          <div className={`kpi-val ${isLow ? 'bad' : 'good'}`} style={isLow ? { animation: 'tracker-blink 1.5s infinite' } : undefined}>{fmtU(stk, 0)}</div>
          <div className="kpi-sub">{t('liquidUsdt')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'var(--brand3)' }}>{t('avPrice')}</span>
          </div>
          <div className="kpi-lbl">{t('avPriceSpread')}</div>
          <div className="kpi-val" style={{ fontSize: 16, color: 'var(--t2)' }}>{wacop ? fmtP(wacop) + ' QAR' : t('noStock')}</div>
          <div className="kpi-sub">
            {(() => {
              const sp = wacop && p2pAvgs.avgSell ? fmtPrice((p2pAvgs.avgSell - wacop) / wacop * 100) : null;
              return sp !== null
                ? <span className={Number(sp) >= 0 ? 'good' : 'bad'} style={{ fontWeight: 700 }}>{Number(sp) >= 0 ? '+' : ''}{sp}% vs P2P</span>
                : t('sellAboveAvPrice');
            })()}
          </div>
        </div>
      </div>

      {/* Cash · Buying Power · Net Position · Stock Cost Est */}
      <div className="kpis" style={{ marginTop: 0 }}>
        {/* ── Upgraded Cash KPI ── */}
        {(() => {
          const cashAccounts = state.cashAccounts || [];
          const cashLedger = state.cashLedger || [];
          const hasAccounts = cashAccounts.length > 0;
          const totalCash = hasAccounts ? deriveCashQAR(cashAccounts, cashLedger) : num(state.cashQAR, 0);

          return (
            <div className="kpi-card" style={{ cursor: !isAdminView ? 'pointer' : 'default' }} onClick={!isAdminView ? () => navigate('/trading/stock?tab=cash') : undefined}>
              <div className="kpi-head">
                <span className="kpi-badge" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb,var(--warn) 30%,transparent)', background: 'color-mix(in srgb,var(--warn) 10%,transparent)' }}>
                  💰 {t('cash')}
                </span>
              </div>
              <div className="kpi-lbl">{t('cashAvailable')}</div>
              <div className="kpi-val" style={{ color: 'var(--warn)' }}>{fmtQWithUnit(totalCash)}</div>
              <div className="kpi-sub">
                {!isAdminView && <span style={{ fontSize: 9, color: 'var(--brand)', fontWeight: 600 }}>{t('openCashMgmt')}</span>}
              </div>
            </div>
          );
        })()}
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--t5)', borderColor: 'color-mix(in srgb,var(--t5) 30%,transparent)', background: 'color-mix(in srgb,var(--t5) 10%,transparent)' }}>@{t('avPrice')}</span>
          </div>
          <div className="kpi-lbl">{t('buyingPower')}</div>
          {(() => {
            const cash = num(state.cashQAR, 0);
            const refPrice = wacop || p2pAvgs.avgBuy;
            const isFallback = !wacop && !!p2pAvgs.avgBuy;
            return (
              <>
                <div className="kpi-val" style={{ color: 'var(--t5)' }}>
                  {refPrice && cash > 0
                    ? fmtU(cash / refPrice, 0) + ' USDT'
                    : cash > 0
                      ? fmtQ(cash) + ' QAR'
                      : t('setCash')}
                </div>
                <div className="kpi-sub">
                  {refPrice
                    ? `@ ${fmtP(refPrice)} QAR${isFallback ? ` ${t('mktAvg')}` : ''}`
                    : cash > 0
                      ? t('addBatchesFirst')
                      : t('addBatchesFirst')}
                </div>
              </>
            );
          })()}
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--good)', borderColor: 'color-mix(in srgb,var(--good) 30%,transparent)', background: 'color-mix(in srgb,var(--good) 10%,transparent)' }}>{t('net')}</span>
          </div>
          <div className="kpi-lbl">{t('netPosition')}</div>
          <div className="kpi-val good">{fmtQWithUnit(stCost + num(state.cashQAR, 0))}</div>
          <div className="kpi-sub">{t('stock')} {fmtQWithUnit(stCost)} + {t('cash')} {fmtQWithUnit(num(state.cashQAR, 0))}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--muted)', borderColor: 'color-mix(in srgb,var(--muted) 30%,transparent)', background: 'color-mix(in srgb,var(--muted) 10%,transparent)' }}>{state.batches.length} {t('batchSuffix')}</span>
          </div>
          <div className="kpi-lbl">{t('stockCostEst')}</div>
          <div className="kpi-val" style={{ color: 'var(--text)' }}>{fmtQWithUnit(stCost)}</div>
          <div className="kpi-sub">{t('avPrice')} {wacop ? fmtP(wacop) + ' QAR' : '—'}</div>
        </div>
      </div>

      {/* New KPIs: ROI · Cycle Time · Velocity · Outgoing Net · Incoming Net */}
      <div className="kpis" style={{ marginTop: 0 }}>
        {/* Daily ROI (7D / 30D toggle) */}
        {(() => {
          const roiData = roiPeriod === '7d' ? d7 : d30;
          const roiVal = stCost > 0 ? (roiData.net / stCost) * 100 : 0;
          const isExpanded = expandedNewKpi === 'roi';
          return (
            <div className="kpi-card" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setExpandedNewKpi(isExpanded ? null : 'roi')}>
              <div className="kpi-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="kpi-badge" style={{ color: 'var(--good)', borderColor: 'color-mix(in srgb,var(--good) 30%,transparent)', background: 'color-mix(in srgb,var(--good) 10%,transparent)' }}>
                  💹
                </span>
              </div>
              <div className="kpi-lbl">{t('roiLabel')}</div>
              <div className={`kpi-val ${roiVal >= 0 ? 'good' : 'bad'}`}>{fmtPrice(roiVal)}%</div>
              <div className="kpi-sub">{t('roiSub')}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span
                  className="kpi-badge"
                  style={{
                    fontSize: 9, padding: '1px 6px', cursor: 'pointer',
                    color: roiPeriod === '7d' ? 'var(--brand)' : 'var(--muted)',
                    borderColor: `color-mix(in srgb,${roiPeriod === '7d' ? 'var(--brand)' : 'var(--muted)'} 30%,transparent)`,
                    background: `color-mix(in srgb,${roiPeriod === '7d' ? 'var(--brand)' : 'var(--muted)'} 10%,transparent)`,
                    fontWeight: roiPeriod === '7d' ? 700 : 400,
                  }}
                  onClick={(e) => { e.stopPropagation(); setRoiPeriod('7d'); }}
                >7D</span>
                <span
                  className="kpi-badge"
                  style={{
                    fontSize: 9, padding: '1px 6px', cursor: 'pointer',
                    color: roiPeriod === '30d' ? 'var(--brand)' : 'var(--muted)',
                    borderColor: `color-mix(in srgb,${roiPeriod === '30d' ? 'var(--brand)' : 'var(--muted)'} 30%,transparent)`,
                    background: `color-mix(in srgb,${roiPeriod === '30d' ? 'var(--brand)' : 'var(--muted)'} 10%,transparent)`,
                    fontWeight: roiPeriod === '30d' ? 700 : 400,
                  }}
                  onClick={(e) => { e.stopPropagation(); setRoiPeriod('30d'); }}
                >30D</span>
                <span className="kpi-badge" style={{ fontSize: 9, padding: '1px 6px', color: 'var(--muted)', borderColor: 'color-mix(in srgb,var(--muted) 30%,transparent)', background: 'color-mix(in srgb,var(--muted) 10%,transparent)' }}>{t('orders')}</span>
                <span style={{ fontSize: 9, color: 'var(--warn)', marginLeft: 'auto' }}>💡 {isExpanded ? t('collapseLbl') : t('tapExpand')}</span>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderTop: '1px solid var(--line)', fontSize: 11, lineHeight: 1.6, color: 'var(--t3)' }}>
                  <p>Return on invested capital for {roiPeriod === '7d' ? '7 days' : '30 days'} — normalizes profit vs full book.</p>
                  <p style={{ marginTop: 4 }}><strong style={{ color: 'var(--warn)' }}>Why:</strong> Raw QAR profit is misleading without context of how much capital is deployed.</p>
                  <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: 'var(--panel2)', fontFamily: 'monospace', fontSize: 10, color: 'var(--good)' }}>
                    = {roiPeriod}.netQAR ÷ stockCostQAR × 100
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Avg Cycle Time */}
        {(() => {
          const isExpanded = expandedNewKpi === 'cycle';
          return (
            <div className="kpi-card" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setExpandedNewKpi(isExpanded ? null : 'cycle')}>
              <div className="kpi-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="kpi-badge" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb,var(--warn) 30%,transparent)', background: 'color-mix(in srgb,var(--warn) 10%,transparent)' }}>
                  ⏱️
                </span>
              </div>
              <div className="kpi-lbl">{t('avgCycleTime')}</div>
              <div className="kpi-val" style={{ color: 'var(--warn)' }}>{cycleHours !== null ? `${fmtTotal(cycleHours)}h` : '—'}</div>
              <div className="kpi-sub">{t('avgCycleTimeSub')}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                <span className="kpi-badge" style={{ fontSize: 9, padding: '1px 6px', color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'color-mix(in srgb,var(--brand) 10%,transparent)' }}>FIFO</span>
                <span className="kpi-badge" style={{ fontSize: 9, padding: '1px 6px', color: 'var(--muted)', borderColor: 'color-mix(in srgb,var(--muted) 30%,transparent)', background: 'color-mix(in srgb,var(--muted) 10%,transparent)' }}>Stock</span>
                <span style={{ fontSize: 9, color: 'var(--warn)', marginLeft: 'auto' }}>💡 {isExpanded ? t('collapseLbl') : t('tapExpand')}</span>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderTop: '1px solid var(--line)', fontSize: 11, lineHeight: 1.6, color: 'var(--t3)' }}>
                  <p>Average hours from buying a batch to it being consumed in sales.</p>
                  <p style={{ marginTop: 4 }}><strong style={{ color: 'var(--warn)' }}>Why:</strong> Shorter cycle = faster capital rotation and less exposure to price moves.</p>
                  <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: 'var(--panel2)', fontFamily: 'monospace', fontSize: 10, color: 'var(--good)' }}>
                    = avg(trade.ts – slice.batchTs) per FIFO slice
                  </div>
                </div>
              )}
            </div>
          );
        })()}


        {/* Outgoing Deals Net Profit */}
        {merchantDealKpis && (
          <div className="kpi-card">
            <div className="kpi-head">
              <span className="kpi-badge" style={{ color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'color-mix(in srgb,var(--brand) 10%,transparent)' }}>
                📤 {merchantDealKpis.outCount} deals
              </span>
            </div>
            <div className="kpi-lbl">{t('outgoingNet')}</div>
            <div className={`kpi-val ${merchantDealKpis.outNet >= 0 ? 'good' : 'bad'}`}>
              {merchantDealKpis.outNet >= 0 ? '+' : ''}{fmtQWithUnit(merchantDealKpis.outNet)}
            </div>
            <div className="kpi-sub">{t('myCutLabel')}: {fmtQWithUnit(merchantDealKpis.dealDetails.filter(d => d.direction === 'outgoing').reduce((s, d) => s + d.myShare, 0))}</div>
          </div>
        )}

        {/* Incoming Deals Net Profit */}
        {merchantDealKpis && (
          <div className="kpi-card">
            <div className="kpi-head">
              <span className="kpi-badge" style={{ color: 'var(--good)', borderColor: 'color-mix(in srgb,var(--good) 30%,transparent)', background: 'color-mix(in srgb,var(--good) 10%,transparent)' }}>
                📥 {merchantDealKpis.inCount} deals
              </span>
            </div>
            <div className="kpi-lbl">{t('incomingNet')}</div>
            <div className={`kpi-val ${merchantDealKpis.inNet >= 0 ? 'good' : 'bad'}`}>
              {merchantDealKpis.inNet >= 0 ? '+' : ''}{fmtQWithUnit(merchantDealKpis.inNet)}
            </div>
            <div className="kpi-sub">{t('myCutLabel')}: {fmtQWithUnit(merchantDealKpis.dealDetails.filter(d => d.direction === 'incoming').reduce((s, d) => s + d.myShare, 0))}</div>
          </div>
        )}
      </div>

      {/* Bottom panels */}
      <div className="dash-bottom">
        <div className="panel">
          <div className="panel-head"><h2>{t('profitRevenueTrend')}</h2><span className="pill">{t('last14Trades')}</span></div>
          <div className="panel-body" style={{ height: 190, position: 'relative' }}>
            {trendData.length < 2 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('needAtLeast2Trades')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" name={t('volume') || 'Revenue'} stroke="#6366f1" fill="url(#gRevenue)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="profit" name={t('netProfitLabel') || 'Profit'} stroke="#22c55e" fill="url(#gProfit)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{t('periodStats')}</h2><span className="pill">{rLabel}</span></div>
          <div className="panel-body">
            <div className="prev-row"><span className="muted">{t('volume')}</span><strong className="mono t1v">{fmtQWithUnit(dR.rev)}</strong></div>
            <div className="prev-row"><span className="muted">{t('cost')}</span><strong className="mono">{fmtQWithUnit(dR.rev - dR.net - dR.fee)}</strong></div>
            <div className="prev-row"><span className="muted">{t('fees')}</span><strong className="mono">{fmtQWithUnit(dR.fee)}</strong></div>
            <div className="prev-row"><span className="muted">{t('netProfitLabel')}</span><strong className={`mono ${dR.net >= 0 ? 'good' : 'bad'}`}>{fmtQWithUnit(dR.net)}</strong></div>
            <div className="prev-row"><span className="muted">{t('avgMargin')}</span><strong className="mono" style={{ color: 'var(--t3)' }}>{fmtPct(dR.avgMgn)}</strong></div>
            <div className="prev-row"><span className="muted">{t('trades')}</span><strong className="mono">{dR.count}</strong></div>
          </div>
        </div>
      </div>

      {/* Chart panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="panel">
          <div className="panel-head"><h2>{t('netProfitPerTrade')}</h2><span className="pill muted">{t('allTime')}</span></div>
          <div className="panel-body" style={{ height: 170, position: 'relative' }}>
            {profitPerTradeData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('noTradesYet')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitPerTradeData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="idx" tick={{ fontSize: 8, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.4} strokeDasharray="3 3" />
                  <Bar dataKey="profit" name={t('netProfitLabel') || 'Profit'} radius={[2, 2, 0, 0]} maxBarSize={12}>
                    {profitPerTradeData.map((entry, i) => (
                      <Cell key={i} fill={entry.positive ? '#22c55e' : '#ef4444'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{t('dailyVolumeProfit')}</h2><span className="pill muted">{t('byDay')}</span></div>
          <div className="panel-body" style={{ height: 170, position: 'relative' }}>
            {dailyData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span className="muted" style={{ fontSize: 11 }}>{t('noTradesYet')}</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" name={t('volume') || 'Volume'} fill="#6366f1" fillOpacity={0.5} radius={[2, 2, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="profit" name={t('netProfitLabel') || 'Profit'} fill="#22c55e" fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {showCashBox && !isAdminView && (
        <CashBoxManager
          currentCash={num(state.cashQAR, 0)}
          currentOwner={state.cashOwner || ''}
          cashHistory={state.cashHistory || []}
          onSave={handleCashSave}
          onClose={() => setShowCashBox(false)}
        />
      )}
    </div>
  );
}
