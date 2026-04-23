import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtU, fmtPct,
  fmtTotal, fmtPrice,
  kpiFor, totalStock, stockCostQAR, getWACOP,
  rangeLabel, num, startOfDay, inRange,
  deriveCashQAR,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT, getCurrencyLabel } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useQuery } from '@tanstack/react-query';
import { CashBoxManager } from '@/features/dashboard/components/CashBoxManager';
import { useP2PRates } from '@/features/dashboard/hooks/useP2PRates';
import { buildDealRowModel } from '@/features/orders/utils/dealRowModel';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  AreaChart, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import '@/styles/tracker.css';

interface DashboardPageProps {
  adminUserId?: string;
  adminMerchantId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminTrackerState?: any;
  isAdminView?: boolean;
}

export default function DashboardPage({ adminUserId, adminMerchantId, adminTrackerState, isAdminView }: DashboardPageProps = {}) {
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAdminWorkspace = Boolean(isAdminView);
  const { user, merchantProfile } = useAuth();
  const resolvedUserId = isAdminWorkspace ? adminUserId : user?.id;
  const resolvedMerchantId = isAdminWorkspace ? adminMerchantId : merchantProfile?.merchant_id;
  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
    preloadedState: adminTrackerState,
    disableCloudSync: isAdminWorkspace,
  });

  const dM = kpiFor(state, derived, 'this_month');
  const dL = kpiFor(state, derived, 'last_month');
  const d7  = kpiFor(state, derived, '7d');
  const d30 = kpiFor(state, derived, '30d');
  const dR = kpiFor(state, derived, settings.range);
  const stk = totalStock(derived);
  const stCost = stockCostQAR(derived);
  const averageStockPrice = getWACOP(derived);
  const rLabel = rangeLabel(settings.range);
  const baseFiat = settings.baseFiatCurrency || 'QAR';
  const { data: qatarP2PRate } = useP2PRates('qatar');
  const { data: egyptP2PRate } = useP2PRates('egypt');

  const dashboardQarPerUsdt = useMemo(() => {
    const qatarBuyRate = num(qatarP2PRate?.buyRate, 0);
    if (qatarBuyRate > 0) return qatarBuyRate;
    const stockRate = num(averageStockPrice, 0);
    return stockRate > 0 ? stockRate : null;
  }, [averageStockPrice, qatarP2PRate?.buyRate]);

  const egyptBuyRate = useMemo(() => {
    const marketRate = num(egyptP2PRate?.buyRate, 0);
    return marketRate > 0 ? marketRate : null;
  }, [egyptP2PRate?.buyRate]);

  const convertDashboardFiat = useCallback((qarAmount: number) => {
    const amount = num(qarAmount, Number.NaN);
    if (!Number.isFinite(amount)) return null;

    if (settings.currency === 'USDT' && dashboardQarPerUsdt && dashboardQarPerUsdt > 0) {
      return { amount: amount / dashboardQarPerUsdt, currency: 'USDT' as const };
    }

    if (settings.currency === 'EGP' && dashboardQarPerUsdt && dashboardQarPerUsdt > 0 && egyptBuyRate && egyptBuyRate > 0) {
      return { amount: (amount / dashboardQarPerUsdt) * egyptBuyRate, currency: 'EGP' as const };
    }

    return { amount, currency: 'QAR' as const };
  }, [dashboardQarPerUsdt, egyptBuyRate, settings.currency]);

  const fmtDashboardAmount = useCallback((qarAmount: number) => {
    const converted = convertDashboardFiat(qarAmount);
    if (!converted) return '—';
    if (converted.currency === 'USDT') return `${fmtPrice(converted.amount)} USDT`;
    return `${fmtTotal(converted.amount)} ${converted.currency}`;
  }, [convertDashboardFiat]);

  const fmtDashboardPrice = useCallback((priceQarPerUsdt: number) => {
    const price = num(priceQarPerUsdt, Number.NaN);
    if (!Number.isFinite(price)) return '—';

    if (settings.currency === 'EGP' && dashboardQarPerUsdt && dashboardQarPerUsdt > 0 && egyptBuyRate && egyptBuyRate > 0) {
      return `${fmtPrice((price / dashboardQarPerUsdt) * egyptBuyRate)} EGP`;
    }

    return `${fmtPrice(price)} QAR`;
  }, [dashboardQarPerUsdt, egyptBuyRate, settings.currency]);

  const allTrades = state.trades.filter(t => !t.voided);
  const getTradeMyPct = (tr: typeof allTrades[0]) => {
    const merchantPct = Number(tr.merchantPct);
    if (Number.isFinite(merchantPct) && merchantPct > 0 && merchantPct <= 100) return merchantPct;
    const partnerPct = Number(tr.partnerPct);
    if (Number.isFinite(partnerPct) && partnerPct >= 0 && partnerPct < 100) return 100 - partnerPct;
    return 100;
  };
  const allMargins = allTrades.map(tr => {
    const c = derived.tradeCalc.get(tr.id);
    if (!c?.ok) return null;
    if (tr.linkedDealId || tr.linkedRelId) {
      const myPct = getTradeMyPct(tr);
      const myNet = c.netQAR * myPct / 100;
      const rev = tr.amountUSDT * tr.sellPriceQAR;
      return rev > 0 ? (myNet / rev) * 100 : 0;
    }
    return c.margin;
  }).filter((x): x is number => x !== null);
  const avgM = allMargins.length ? allMargins.reduce((s, v) => s + v, 0) / allMargins.length : 0;

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
  const userId = resolvedUserId;
  const workspaceMerchantId = resolvedMerchantId;

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
    ts: number;
  }

  const { data: merchantDealKpis } = useQuery({
    queryKey: ['dashboard-merchant-deals', userId, workspaceMerchantId],
    staleTime: 15_000,
    refetchInterval: 30_000,
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
            .select('id, amount, status, created_by, notes, deal_type, relationship_id, title, created_at')
            .in('relationship_id', relIds)
            .order('created_at', { ascending: false })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : { data: [] as any[] };
      if (!deals || deals.length === 0) return null;

      const activeDeals = deals.filter(d => d.status !== 'cancelled' && d.status !== 'voided');
      const dealRelIds = [...new Set(activeDeals.map(d => d.relationship_id))];
      const { data: rels } = dealRelIds.length > 0
        ? await supabase.from('merchant_relationships').select('id, merchant_a_id, merchant_b_id').in('id', dealRelIds)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : { data: [] as any[] };

      const allMerchantIds = new Set<string>();
      for (const r of (rels || [])) { allMerchantIds.add(r.merchant_a_id); allMerchantIds.add(r.merchant_b_id); }

      const { data: profiles } = allMerchantIds.size > 0
        ? await supabase.from('merchant_profiles').select('merchant_id, display_name, user_id').in('merchant_id', [...allMerchantIds])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : { data: [] as any[] };

      const profileMap = new Map<string, { name: string; userId: string }>();
      for (const p of (profiles || [])) profileMap.set(p.merchant_id, { name: p.display_name, userId: p.user_id });

      const relMap = new Map<string, { merchant_a_id: string; merchant_b_id: string }>();
      for (const r of (rels || [])) relMap.set(r.id, r);

      let outCount = 0, outVol = 0, outNet = 0, outMyShare = 0;
      let inCount = 0, inVol = 0, inNet = 0, inMyShare = 0;
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
          outCount++; outVol += vol; outNet += dealNet; outMyShare += myShare;
        } else {
          inCount++; inVol += vol; inNet += dealNet; inMyShare += myShare;
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
          ts: (() => {
            const tradeDateRaw = row.meta.trade_date;
            const fromMeta = tradeDateRaw ? new Date(tradeDateRaw).getTime() : NaN;
            const fromCreatedAt = d.created_at ? new Date(d.created_at).getTime() : NaN;
            return Number.isFinite(fromMeta) ? fromMeta : (Number.isFinite(fromCreatedAt) ? fromCreatedAt : Date.now());
          })(),
        });
      }

      return {
        totalDeals: activeDeals.length,
        outCount, outVol, outNet, outMyShare,
        inCount, inVol, inNet, inMyShare,
        pendingCount, approvedCount,
        totalVol: outVol + inVol,
        totalNet: outMyShare + inMyShare,
        totalMyShare, totalPartnerShare,
        dealDetails,
      };
    },
    enabled: !!userId && !!workspaceMerchantId,
  });

  const handleCashSave = useCallback((newCash: number, owner: string, history?: import('@/lib/tracker-helpers').CashTransaction[]) => {
    applyState({ ...state, cashQAR: newCash, cashOwner: owner, cashHistory: history ?? state.cashHistory ?? [] });
  }, [state, applyState]);

  const rangeMerchantKpis = useMemo(() => {
    if (!merchantDealKpis?.dealDetails) return null;
    const filtered = merchantDealKpis.dealDetails.filter(d => inRange(d.ts, settings.range));
    let inCount = 0, inNet = 0, inMyShare = 0;
    let outCount = 0, outNet = 0, outMyShare = 0;
    for (const d of filtered) {
      if (d.direction === 'incoming') {
        inCount++; inNet += d.net; inMyShare += d.myShare;
      } else {
        outCount++; outNet += d.net; outMyShare += d.myShare;
      }
    }
    return { inCount, inNet, inMyShare, outCount, outNet, outMyShare };
  }, [merchantDealKpis, settings.range]);

  const p2pAvgs = useMemo(() => {
    const sellTrades = allTrades.filter(t => t.usesStock && t.sellPriceQAR > 0);
    const avgSell = sellTrades.length ? sellTrades.reduce((s, t) => s + t.sellPriceQAR, 0) / sellTrades.length : null;
    const batches = state.batches.filter(b => b.buyPriceQAR > 0);
    const avgBuy = batches.length ? batches.reduce((s, b) => s + b.buyPriceQAR, 0) / batches.length : null;
    return { avgSell, avgBuy };
  }, [allTrades, state.batches]);

  const tradeNet = useCallback((tr: typeof allTrades[0]) => {
    const c = derived.tradeCalc.get(tr.id);
    let fullNet = 0;
    if (c?.ok) fullNet = c.netQAR;
    else if (tr.manualBuyPrice) fullNet = tr.amountUSDT * tr.sellPriceQAR - tr.amountUSDT * tr.manualBuyPrice - tr.feeQAR;
    if (tr.linkedDealId || tr.linkedRelId) {
      const myPct = getTradeMyPct(tr);
      return fullNet * myPct / 100;
    }
    return fullNet;
  }, [derived.tradeCalc]);

  // ── Segmented Net Profit KPI (Own / Incoming / Outgoing) ──────────────
  const segmentedProfit = useMemo(() => {
    const computeForRange = (range: string) => {
      const ownTrades = allTrades.filter(tr => !tr.linkedDealId && !tr.linkedRelId && inRange(tr.ts, range));
      let ownNet = 0, ownRev = 0, ownQty = 0, ownCount = 0;
      for (const tr of ownTrades) {
        ownNet += tradeNet(tr);
        ownRev += tr.amountUSDT * tr.sellPriceQAR;
        ownQty += tr.amountUSDT;
        ownCount++;
      }
      let inMyShare = 0, inVol = 0, inCount = 0;
      let outMyShare = 0, outVol = 0, outCount = 0;
      if (merchantDealKpis?.dealDetails) {
        const seen = new Set<string>();
        for (const d of merchantDealKpis.dealDetails) {
          if (!inRange(d.ts, range)) continue;
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          if (!Number.isFinite(d.myShare)) continue;
          if (d.direction === 'incoming') { inMyShare += d.myShare; inVol += d.vol; inCount++; }
          else if (d.direction === 'outgoing') { outMyShare += d.myShare; outVol += d.vol; outCount++; }
        }
      }
      const totalNet = ownNet + inMyShare + outMyShare;
      const totalRev = ownRev + inVol + outVol;
      return { ownNet, ownRev, ownQty, ownCount, inMyShare, inVol, inCount, outMyShare, outVol, outCount, total: totalNet, totalRev };
    };
    return {
      thisMonth: computeForRange('this_month'),
      lastMonth: computeForRange('last_month'),
      range: computeForRange(settings.range),
    };
  }, [allTrades, merchantDealKpis, settings.range, tradeNet]);

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
  }, [allTrades, tradeNet]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: 'var(--panel2)', border: '1px solid var(--line)',
        borderRadius: 6, padding: '6px 10px', fontSize: 10,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload.map((p: any, i: number) => (
          <div key={i} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <span>{p.name}</span>
            <span className="mono" style={{ fontWeight: 700 }}>{fmtDashboardAmount(Number(p.value))}</span>
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

  const now = new Date();
  const monthKeys = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const curMo = t(monthKeys[now.getMonth()] as any);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevMo = t(monthKeys[prevDate.getMonth()] as any);

  if (isAdminWorkspace && (!resolvedUserId || !resolvedMerchantId || adminTrackerState === undefined)) {
    return (
      <div className="tracker-root" style={{ padding: 12 }}>
        <div className="empty">
          <div className="empty-t">
            {!resolvedUserId || !resolvedMerchantId ? 'Target workspace is not ready.' : 'No tracker snapshot found for this user.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`tracker-root${isMobile ? ' dashboard-mobile-root' : ''}`} dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: isMobile ? '6px 0' : 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
      <div className="kpi-band-grid">
        <div className="kpi-band">
          <div className="kpi-band-title">{t('tradingVolume')}</div>
          <div className="kpi-band-cols">
            <div>
              <div className="kpi-period">{curMo}</div>
              {[
                { label: `🏠 ${t('ownOrdersLabel')}`, val: segmentedProfit.thisMonth.ownRev, sub: `${segmentedProfit.thisMonth.ownCount} ${t('trades')} · ${fmtU(segmentedProfit.thisMonth.ownQty, 0)} USDT` },
                { label: `📥 ${t('incomingOrders')}`, val: segmentedProfit.thisMonth.inVol, sub: `${segmentedProfit.thisMonth.inCount} ${t('deals') || 'deals'}` },
                { label: `📤 ${t('outgoingOrders')}`, val: segmentedProfit.thisMonth.outVol, sub: `${segmentedProfit.thisMonth.outCount} ${t('deals') || 'deals'}` },
              ].map(row => (
                <div key={row.label} style={{ padding: '2px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>{row.label}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{fmtDashboardAmount(row.val)}</span>
                  </div>
                  <div className="kpi-cell-sub" style={{ fontSize: 8, textAlign: 'end' }}>{row.sub}</div>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.5px' }}>📊 {t('totalLabel')}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)' }}>{fmtDashboardAmount(segmentedProfit.thisMonth.totalRev)}</span>
              </div>
            </div>
            <div>
              <div className="kpi-period">{prevMo}</div>
              {[
                { label: `🏠 ${t('ownOrdersLabel')}`, val: segmentedProfit.lastMonth.ownRev, sub: `${segmentedProfit.lastMonth.ownCount} ${t('trades')} · ${fmtU(segmentedProfit.lastMonth.ownQty, 0)} USDT` },
                { label: `📥 ${t('incomingOrders')}`, val: segmentedProfit.lastMonth.inVol, sub: `${segmentedProfit.lastMonth.inCount} ${t('deals') || 'deals'}` },
                { label: `📤 ${t('outgoingOrders')}`, val: segmentedProfit.lastMonth.outVol, sub: `${segmentedProfit.lastMonth.outCount} ${t('deals') || 'deals'}` },
              ].map(row => (
                <div key={row.label} style={{ padding: '2px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>{row.label}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{fmtDashboardAmount(row.val)}</span>
                  </div>
                  <div className="kpi-cell-sub" style={{ fontSize: 8, textAlign: 'end' }}>{row.sub}</div>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.5px' }}>📊 {t('totalLabel')}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)' }}>{fmtDashboardAmount(segmentedProfit.lastMonth.totalRev)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="kpi-band">
          <div className="kpi-band-title">{t('myNetProfit')}</div>
          <div className="kpi-band-cols">
            {/* Current Month */}
            <div>
              <div className="kpi-period">{curMo}</div>
              {[
                { label: `🏠 ${t('ownOrdersLabel')}`, val: segmentedProfit.thisMonth.ownNet },
                { label: `📥 ${t('incomingOrders')}`, val: segmentedProfit.thisMonth.inMyShare },
                { label: `📤 ${t('outgoingOrders')}`, val: segmentedProfit.thisMonth.outMyShare },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>{row.label}</span>
                  <span className={`mono ${row.val >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 11, fontWeight: 700 }}>
                    {row.val >= 0 ? '+' : ''}{fmtDashboardAmount(row.val)}
                  </span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.5px' }}>📊 {t('totalLabel')}</span>
                <span className={`mono ${segmentedProfit.thisMonth.total >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 13, fontWeight: 800 }}>
                  {segmentedProfit.thisMonth.total >= 0 ? '+' : ''}{fmtDashboardAmount(segmentedProfit.thisMonth.total)}
                </span>
              </div>
            </div>
            {/* Previous Month */}
            <div>
              <div className="kpi-period">{prevMo}</div>
              {[
                { label: `🏠 ${t('ownOrdersLabel')}`, val: segmentedProfit.lastMonth.ownNet },
                { label: `📥 ${t('incomingOrders')}`, val: segmentedProfit.lastMonth.inMyShare },
                { label: `📤 ${t('outgoingOrders')}`, val: segmentedProfit.lastMonth.outMyShare },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>{row.label}</span>
                  <span className={`mono ${row.val >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 11, fontWeight: 700 }}>
                    {row.val >= 0 ? '+' : ''}{fmtDashboardAmount(row.val)}
                  </span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.5px' }}>📊 {t('totalLabel')}</span>
                <span className={`mono ${segmentedProfit.lastMonth.total >= 0 ? 'good' : 'bad'}`} style={{ fontSize: 13, fontWeight: 800 }}>
                  {segmentedProfit.lastMonth.total >= 0 ? '+' : ''}{fmtDashboardAmount(segmentedProfit.lastMonth.total)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={badgeStyle(segmentedProfit.range.total >= 0 ? 'good' : 'bad')}>{rLabel}</span>
          </div>
          <div className="kpi-lbl">{t('netProfitLabel')}</div>
          <div className={`kpi-val ${segmentedProfit.range.total >= 0 ? 'good' : 'bad'}`}>{fmtDashboardAmount(segmentedProfit.range.total)}</div>
          <div className="kpi-sub">{t('ownOrdersLabel')} {fmtDashboardAmount(segmentedProfit.range.ownNet)} · {t('incomingOrders')} {fmtDashboardAmount(segmentedProfit.range.inMyShare)} · {t('outgoingOrders')} {fmtDashboardAmount(segmentedProfit.range.outMyShare)}</div>
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
            <span className="kpi-badge" style={{ color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'var(--brand3)' }}>Avg Stock Price</span>
          </div>
          <div className="kpi-lbl">Average Stock Price + Spread</div>
          <div className="kpi-val" style={{ fontSize: 16, color: 'var(--t2)' }}>{averageStockPrice ? fmtDashboardPrice(averageStockPrice) : t('noStock')}</div>
          <div className="kpi-sub">
            {(() => {
              const sp = averageStockPrice && p2pAvgs.avgSell ? fmtPrice((p2pAvgs.avgSell - averageStockPrice) / averageStockPrice * 100) : null;
              return sp !== null
                ? <span className={Number(sp) >= 0 ? 'good' : 'bad'} style={{ fontWeight: 700 }}>{Number(sp) >= 0 ? '+' : ''}{sp}% vs P2P</span>
                : t('sellAboveAvPrice');
            })()}
          </div>
        </div>
      </div>

      <div className="kpis" style={{ marginTop: 0 }}>
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
              <div className="kpi-val" style={{ color: 'var(--warn)' }}>{fmtDashboardAmount(totalCash)}</div>
              <div className="kpi-sub">
                {!isAdminView && <span style={{ fontSize: 9, color: 'var(--brand)', fontWeight: 600 }}>{t('openCashMgmt')}</span>}
              </div>
            </div>
          );
        })()}
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--t5)', borderColor: 'color-mix(in srgb,var(--t5) 30%,transparent)', background: 'color-mix(in srgb,var(--t5) 10%,transparent)' }}>@Avg Price</span>
          </div>
          <div className="kpi-lbl">{t('buyingPower')}</div>
          {(() => {
            const cash = num(state.cashQAR, 0);
            const refPrice = averageStockPrice || p2pAvgs.avgBuy;
            const isFallback = !averageStockPrice && !!p2pAvgs.avgBuy;
            return (
              <>
                <div className="kpi-val" style={{ color: 'var(--t5)' }}>
                  {refPrice && cash > 0
                    ? fmtU(cash / refPrice, 0) + ' USDT'
                    : cash > 0
                      ? fmtDashboardAmount(cash)
                      : t('setCash')}
                </div>
                <div className="kpi-sub">
                  {refPrice
                    ? `@ Avg ${fmtDashboardPrice(refPrice)}${isFallback ? ` ${t('mktAvg')}` : ''}`
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
          <div className="kpi-val good">{fmtDashboardAmount(stCost + num(state.cashQAR, 0))}</div>
          <div className="kpi-sub">{t('stock')} {fmtDashboardAmount(stCost)} + {t('cash')} {fmtDashboardAmount(num(state.cashQAR, 0))}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-badge" style={{ color: 'var(--muted)', borderColor: 'color-mix(in srgb,var(--muted) 30%,transparent)', background: 'color-mix(in srgb,var(--muted) 10%,transparent)' }}>{state.batches.length} {t('batchSuffix')}</span>
          </div>
          <div className="kpi-lbl">{t('stockCostEst')}</div>
          <div className="kpi-val" style={{ color: 'var(--text)' }}>{fmtDashboardAmount(stCost)}</div>
          <div className="kpi-sub">Avg stock price {averageStockPrice ? fmtDashboardPrice(averageStockPrice) : '—'}</div>
        </div>
      </div>

      <div className="kpis" style={{ marginTop: 0 }}>
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

        {rangeMerchantKpis && (
          <div className="kpi-card">
            <div className="kpi-head">
              <span className="kpi-badge" style={{ color: 'var(--brand)', borderColor: 'color-mix(in srgb,var(--brand) 30%,transparent)', background: 'color-mix(in srgb,var(--brand) 10%,transparent)' }}>
                📤 {rangeMerchantKpis.outCount} deals
              </span>
            </div>
            <div className="kpi-lbl">{isAdminView ? `${t('outgoingNet')} · ${t('myCutLabel')}` : t('outgoingNet')}</div>
            <div className={`kpi-val ${rangeMerchantKpis.outMyShare >= 0 ? 'good' : 'bad'}`}>
              {rangeMerchantKpis.outMyShare >= 0 ? '+' : ''}{fmtDashboardAmount(rangeMerchantKpis.outMyShare)}
            </div>
            <div className="kpi-sub">{t('netProfitLabel')}: {fmtDashboardAmount(rangeMerchantKpis.outNet)}</div>
          </div>
        )}

        {rangeMerchantKpis && (
          <div className="kpi-card">
            <div className="kpi-head">
              <span className="kpi-badge" style={{ color: 'var(--good)', borderColor: 'color-mix(in srgb,var(--good) 30%,transparent)', background: 'color-mix(in srgb,var(--good) 10%,transparent)' }}>
                📥 {rangeMerchantKpis.inCount} deals
              </span>
            </div>
            <div className="kpi-lbl">{isAdminView ? `${t('incomingNet')} · ${t('myCutLabel')}` : t('incomingNet')}</div>
            <div className={`kpi-val ${rangeMerchantKpis.inMyShare >= 0 ? 'good' : 'bad'}`}>
              {rangeMerchantKpis.inMyShare >= 0 ? '+' : ''}{fmtDashboardAmount(rangeMerchantKpis.inMyShare)}
            </div>
            <div className="kpi-sub">{t('netProfitLabel')}: {fmtDashboardAmount(rangeMerchantKpis.inNet)}</div>
          </div>
        )}
      </div>

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
            <div className="prev-row"><span className="muted">{t('volume')}</span><strong className="mono t1v">{fmtDashboardAmount(dR.rev)}</strong></div>
            <div className="prev-row"><span className="muted">{t('cost')}</span><strong className="mono">{fmtDashboardAmount(dR.rev - dR.net - dR.fee)}</strong></div>
            {dR.fee > 0 && <div className="prev-row"><span className="muted">{t('fees')}</span><strong className="mono">{fmtDashboardAmount(dR.fee)}</strong></div>}
            <div className="prev-row"><span className="muted">{t('netProfitLabel')}</span><strong className={`mono ${dR.net >= 0 ? 'good' : 'bad'}`}>{fmtDashboardAmount(dR.net)}</strong></div>
            <div className="prev-row"><span className="muted">{t('avgMargin')}</span><strong className="mono" style={{ color: 'var(--t3)' }}>{fmtPct(avgM)}</strong></div>
            <div className="prev-row"><span className="muted">{t('trades')}</span><strong className="mono">{dR.count}</strong></div>
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
          baseFiatCurrency={baseFiat}
        />
      )}
    </div>
  );
}
