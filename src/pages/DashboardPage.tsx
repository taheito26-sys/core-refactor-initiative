import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtU,
  fmtTotal, fmtPrice,
  kpiFor, totalStock, stockCostQAR, getWACOP,
  num, inRange,
  deriveCashQAR, getLoanRemaining, getAccountBalance,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT, getCurrencyLabel } from '@/lib/i18n';
import { localCur } from '@/lib/currency-locale';import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useQuery } from '@tanstack/react-query';
import { CashBoxManager } from '@/features/dashboard/components/CashBoxManager';
import { useExchangeBalances } from '@/features/exchanges/hooks/useExchangeBalances';
import { saveTrackerStateNow } from '@/lib/tracker-sync';
import { activateTrackerClearBarrier, markTrackerClearInProgress } from '@/lib/tracker-backup';
import { useP2PRates } from '@/features/dashboard/hooks/useP2PRates';
import { buildDealRowModel } from '@/features/orders/utils/dealRowModel';
import { useIsMobile } from '@/hooks/use-mobile';
import { CustomKpis, type KpiPeriod } from '@/features/dashboard/components/CustomKpis';
import type { KpiOption } from '@/features/dashboard/kpi-catalog';
import { DashboardHome, type HomeTile } from '@/features/dashboard/components/home/DashboardHome';
import { useBanqueMisrRate } from '@/features/dashboard/hooks/useBanqueMisrRate';
import { useDashboardFilters } from '@/features/dashboard/dashboard-filters';
import {
  activeClients, deltaWindow, pctChange, rangeWindow, scopePoints, sparkline, summarize, summarizeWithPrevious,
  resample, runningAverage, runningTotal, type DashPoint,
} from '@/features/dashboard/dashboard-model';
import { agoLabel } from '@/features/p2p/merchant-watch/merchant-watch';
import { listSharedOrdersForActor } from '@/features/orders/shared-order-workflow';
import { ArrowLeftRight, BadgeDollarSign, Boxes, Clock, Hourglass, Landmark, PieChart, Percent, Receipt, Ruler, ShoppingCart } from 'lucide-react';

const UsdtGlyph = () => <b className="dh-glyph">₮</b>;
import ClassicDashboardPage from '@/pages/ClassicDashboardPage';
import { useHomeDesign } from '@/features/orders/v2/design';
import '@/styles/tracker.css';
import '@/styles/dashboard-home.css';

interface DashboardPageProps {
  adminUserId?: string;
  adminMerchantId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminTrackerState?: any;
  isAdminView?: boolean;
}

/** The merchant home: the redesigned dashboard, or the classic one when the user has switched back to it. */
export default function DashboardPage(props: DashboardPageProps = {}) {
  const [design] = useHomeDesign();
  return design === 'classic'
    ? <ClassicDashboardPage {...props} />
    : <DashboardHomePage {...props} />;
}

function DashboardHomePage({ adminUserId, adminMerchantId, adminTrackerState, isAdminView, topSlot }: DashboardPageProps & { topSlot?: ReactNode }) {
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
  const liveCashQAR = useMemo(
    () => deriveCashQAR(state.cashAccounts || [], state.cashLedger || []),
    [state.cashAccounts, state.cashLedger]
  );
  const averageStockPrice = getWACOP(derived);
  const baseFiat = settings.baseFiatCurrency || 'QAR';
  const { data: qatarP2PRate } = useP2PRates('qatar');
  const { data: egyptP2PRate } = useP2PRates('egypt');
  // Exchange USDT available balance (spot + funding), across every connected exchange —
  // same figure shown on the Stock page, synced from exchange-sync, not part of the local FIFO stock.
  const { data: exchangeBalances } = useExchangeBalances();
  const binanceUsdt = useMemo(() => {
    let total = 0;
    for (const b of exchangeBalances ?? []) {
      if (b.asset === 'USDT') total += b.free + b.locked;
    }
    return total;
  }, [exchangeBalances]);

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
    if (converted.currency === 'USDT') return `${fmtPrice(converted.amount)} ${localCur('USDT', t.lang)}`;
    return `${fmtTotal(converted.amount)} ${localCur(converted.currency, t.lang)}`;
  }, [convertDashboardFiat, t.lang]);

  const fmtDashboardPrice = useCallback((priceQarPerUsdt: number) => {
    const price = num(priceQarPerUsdt, Number.NaN);
    if (!Number.isFinite(price)) return '—';

    if (settings.currency === 'EGP' && dashboardQarPerUsdt && dashboardQarPerUsdt > 0 && egyptBuyRate && egyptBuyRate > 0) {
      return `${fmtPrice((price / dashboardQarPerUsdt) * egyptBuyRate)} ${localCur('EGP', t.lang)}`;
    }

    return `${fmtPrice(price)} ${localCur('QAR', t.lang)}`;
  }, [dashboardQarPerUsdt, egyptBuyRate, settings.currency, t.lang]);

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

  /**
   * Customer loans still owed to us — principal minus repayments, grouped by
   * the currency the loan was given in. Deleted loans are tombstoned rather
   * than removed until sync prunes them, so they are filtered out here the
   * same way the Cash page does it.
   */
  const loansUnpaid = useMemo(() => {
    const deletedLoanIds = state.deletedLoanIds || [];
    const loans = (state.customerLoans || []).filter(l => !deletedLoanIds.includes(l.id));
    const byCurrency = new Map<string, number>();
    const debtors = new Set<string>();
    let openCount = 0;
    for (const l of loans) {
      const remaining = getLoanRemaining(l);
      byCurrency.set(l.currency, (byCurrency.get(l.currency) || 0) + remaining);
      if (l.status === 'open') openCount++;
      if (remaining > 0) debtors.add(l.customerId);
    }
    const rows = Array.from(byCurrency.entries())
      .map(([currency, remaining]) => ({ currency, remaining }))
      .filter(r => r.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
    // QAR leads the card when present so the headline matches the dashboard's
    // display currency; anything else rides along in the caption.
    const lead = rows.find(r => r.currency === 'QAR') || rows[0];
    return {
      lead,
      others: rows.filter(r => r !== lead),
      totalRemaining: rows.reduce((s, r) => s + r.remaining, 0),
      openCount,
      debtorCount: debtors.size,
      hasLoans: loans.length > 0,
    };
  }, [state.customerLoans, state.deletedLoanIds]);

  const trackerKpiOptions = useMemo<KpiOption[]>(() => {
    const g = t.lang === 'ar' ? 'التراكر' : 'Tracker';
    const orders = (label: string, d: { count: number }, id: string): KpiOption => ({ id, group: g, label, value: String(d.count), sub: 'trades' });
    return [
      orders('Trades · 7 days', d7, 'tracker:trades7'),
      orders('Trades · 30 days', d30, 'tracker:trades30'),
      orders('Trades · this month', dM, 'tracker:tradesMonth'),
      { id: 'tracker:profit7', group: g, label: 'Net profit · 7 days', value: fmtDashboardAmount(d7.net) },
      { id: 'tracker:profit30', group: g, label: 'Net profit · 30 days', value: fmtDashboardAmount(d30.net) },
      { id: 'tracker:profitMonth', group: g, label: 'Net profit · this month', value: fmtDashboardAmount(dM.net) },
      { id: 'tracker:volume30', group: g, label: 'USDT sold · 30 days', value: fmtTotal(d30.qty), sub: 'USDT' },
      { id: 'tracker:margin30', group: g, label: 'Avg margin · 30 days', value: `${fmtPrice(d30.avgMgn)}%` },
      { id: 'tracker:stock', group: g, label: 'USDT in stock', value: fmtTotal(stk), sub: 'USDT' },
      { id: 'tracker:stockCost', group: g, label: 'Stock cost', value: fmtDashboardAmount(stCost) },
      { id: 'tracker:cash', group: g, label: 'Cash (QAR accounts)', value: fmtDashboardAmount(liveCashQAR) },
      { id: 'tracker:loans', group: g, label: 'Customer loans owed', value: loansUnpaid.lead ? `${fmtTotal(loansUnpaid.totalRemaining)}` : '0', sub: `${loansUnpaid.debtorCount} debtors` },
    ];
  }, [d7, d30, dM, stk, stCost, liveCashQAR, loansUnpaid, fmtDashboardAmount]);

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
    const nextHistory = history ?? state.cashHistory ?? [];
    const isClearAction = newCash === 0 && nextHistory[nextHistory.length - 1]?.note === 'Cash cleared';
    const nextState = isClearAction
      ? {
          ...state,
          cashQAR: 0,
          cashOwner: owner,
          cashHistory: nextHistory,
          cashAccounts: [],
          cashLedger: [],
        }
      : {
          ...state,
          cashQAR: newCash,
          cashOwner: owner,
          cashHistory: nextHistory,
        };

    if (isClearAction) {
      void (async () => {
        try {
          activateTrackerClearBarrier();
          markTrackerClearInProgress();
          await saveTrackerStateNow(nextState, { replaceExisting: true, preserveDataCleared: true, allowDuringClear: true });
          window.location.reload();
        } catch (err) {
          console.error('[DashboardPage] cash clear failed:', err);
        }
      })();
      return;
    }

    applyState(nextState);
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

  // ── Dashboard home ───────────────────────────────────────────────────────
  // One flat list of points (each own trade and each partner deal) feeds every card, so the cards agree.
  const { scope, customFrom, customTo } = useDashboardFilters();
  const customerNames = useMemo(() => new Map((state.customers || []).map(c => [c.id, c.name])), [state.customers]);
  const allPoints = useMemo<DashPoint[]>(() => {
    const rows: DashPoint[] = [];
    // Trades linked to a deal are counted through the deal below, not twice.
    for (const tr of state.trades) {
      if (tr.voided || tr.linkedDealId || tr.linkedRelId) continue;
      const net = tradeNet(tr);
      rows.push({
        ts: tr.ts,
        client: (tr.customerId && customerNames.get(tr.customerId)) || null,
        own: true,
        vol: tr.amountUSDT * tr.sellPriceQAR,
        net,
        fullNet: net,
      });
    }
    const seen = new Set<string>();
    for (const d of merchantDealKpis?.dealDetails ?? []) {
      if (seen.has(d.id) || !Number.isFinite(d.myShare)) continue;
      seen.add(d.id);
      rows.push({
        ts: d.ts,
        client: d.merchantName && d.merchantName !== 'Unknown' ? d.merchantName : null,
        own: false,
        vol: d.vol,
        net: d.myShare,
        fullNet: d.net,
      });
    }
    return rows;
  }, [state.trades, tradeNet, customerNames, merchantDealKpis]);
  const points = useMemo(() => scopePoints(allPoints, scope), [allPoints, scope]);
  const firstTs = useMemo(() => (allPoints.length ? Math.min(...allPoints.map(p => p.ts)) : null), [allPoints]);

  const nowMinute = Math.floor(Date.now() / 60000);
  const nowTs = nowMinute * 60000;
  const win = useMemo(() => {
    const custom = customFrom
      ? { from: new Date(`${customFrom}T00:00`).getTime(), to: new Date(`${customTo || customFrom}T00:00`).getTime() }
      : null;
    return rangeWindow(settings.range, nowMinute * 60000, firstTs, custom);
  }, [settings.range, customFrom, customTo, firstTs, nowMinute]);
  const dateLocale = t.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  const rangeText = `${new Date(win.from).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(win.to).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const fiatParts = useCallback((qarAmount: number) => {
    const c = convertDashboardFiat(qarAmount);
    if (!c) return { n: '—', u: '' };
    return c.currency === 'USDT'
      ? { n: fmtPrice(c.amount), u: localCur('USDT', t.lang) }
      : { n: fmtTotal(c.amount), u: localCur(c.currency, t.lang) };
  }, [convertDashboardFiat, t.lang]);
  const money = useCallback((qarAmount: number) => {
    const p = fiatParts(qarAmount);
    return p.u ? `${p.n} ${p.u}` : p.n;
  }, [fiatParts]);
  const priceParts = (priceQarPerUsdt: number) => {
    const price = num(priceQarPerUsdt, Number.NaN);
    if (!Number.isFinite(price)) return { n: '—', u: '' };
    if (settings.currency === 'EGP' && dashboardQarPerUsdt && dashboardQarPerUsdt > 0 && egyptBuyRate && egyptBuyRate > 0) {
      return { n: fmtPrice((price / dashboardQarPerUsdt) * egyptBuyRate), u: localCur('EGP', t.lang) };
    }
    return { n: fmtPrice(price), u: localCur('QAR', t.lang) };
  };

  const { kpi: misr, loading: misrLoading } = useBanqueMisrRate();
  const { cur: homeCur } = useMemo(() => summarizeWithPrevious(points, win), [points, win]);
  const profitSpark = useMemo(() => sparkline(points, win, p => p.fullNet, 12), [points, win]);

  const cashView = useMemo(() => {
    const accounts = state.cashAccounts || [];
    const ledger = state.cashLedger || [];
    const hasAccounts = accounts.length > 0;
    const total = hasAccounts ? deriveCashQAR(accounts, ledger) : num(state.cashQAR, 0);
    const active = accounts.filter(a => a.status === 'active');
    // deriveCashQAR only sums active, QAR-currency, non-custody accounts; count the same subset so
    // the breakdown always matches the total shown above it.
    const counted = active.filter(a => a.currency === 'QAR' && a.type !== 'merchant_custody');
    return {
      total,
      active: active.length,
      counted: counted.length,
      accounts: counted.map(a => { const balance = getAccountBalance(a.id, ledger); return { name: a.name, balance, shown: fmtTotal(balance) }; }),
    };
  }, [state.cashAccounts, state.cashLedger, state.cashQAR]);

  const { data: customerOrders } = useQuery({
    queryKey: ['dashboard-customer-orders', workspaceMerchantId],
    queryFn: () => listSharedOrdersForActor({ merchantId: workspaceMerchantId }),
    enabled: !!workspaceMerchantId,
    staleTime: 30_000,
  });

  // Each tile's little trend is drawn from the history the app already keeps for that figure.
  const tileSparks = useMemo(() => {
    const live = state.trades.filter(tr => !tr.voided && tr.usesStock);
    const usdt = resample(runningTotal([
      ...state.batches.map(b => ({ ts: b.ts, amount: b.initialUSDT })),
      ...live.map(tr => ({ ts: tr.ts, amount: -tr.amountUSDT })),
    ]));
    const loans = (state.customerLoans || []).filter(l => !(state.deletedLoanIds || []).includes(l.id));
    const unpaid = resample(runningTotal(loans.flatMap(l => [
      { ts: l.ts, amount: l.principal },
      ...(l.repayments || []).map(r => ({ ts: r.ts, amount: -r.amount })),
    ])));
    const avg = resample(runningAverage(state.batches.map(b => ({ ts: b.ts, price: b.buyPriceQAR, weight: b.initialUSDT }))));
    const rate = resample((customerOrders || [])
      .filter(o => Number(o.fx_rate) > 0)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(o => Number(o.fx_rate)));
    return { usdt, unpaid, avg, rate };
  }, [state.trades, state.batches, state.customerLoans, state.deletedLoanIds, customerOrders]);

  // Extra figures under the main ones, all drawn from the same points as the cards above.
  const { cur: moreCur, prev: morePrev } = useMemo(() => summarizeWithPrevious(points, deltaWindow(win, nowTs)), [points, win, nowTs]);
  const fees = useMemo(
    () => state.trades.filter(tr => !tr.voided && tr.ts >= win.from && tr.ts <= win.to).reduce((sum, tr) => sum + (Number(tr.feeQAR) || 0), 0),
    [state.trades, win],
  );
  const pendingApprovals = (customerOrders || []).filter(o => o.workflow_status === 'pending_customer_approval' || o.workflow_status === 'pending_merchant_approval').length;
  const stockCoverDays = useMemo(() => {
    const since = nowTs - 30 * 864e5;
    const sold = state.trades.filter(tr => !tr.voided && tr.usesStock && tr.ts >= since).reduce((sum, tr) => sum + tr.amountUSDT, 0);
    return sold > 0 && stk > 0 ? Math.round(stk / (sold / 30)) : null;
  }, [state.trades, stk, nowTs]);
  const pctLine = (cur: number, prev: number | null | undefined) => {
    const p = pctChange(cur, prev);
    return p == null ? undefined : <span className={p >= 0 ? 'good' : 'bad'}>{p >= 0 ? '↑ +' : '↓ '}{p.toFixed(1)}% {t('dhVsPrev')}</span>;
  };
  const moreTiles: HomeTile[] = (() => {
    const avgOrder = fiatParts(moreCur.orders ? moreCur.vol / moreCur.orders : 0);
    const margin = moreCur.vol > 0 ? (moreCur.net / moreCur.vol) * 100 : 0;
    const feeParts = fiatParts(fees);
    return [
      { key: 'orders', label: t('dhOrdersCount'), Icon: ShoppingCart, tone: 'good', unitTone: 'brand', value: String(moreCur.orders), unit: t('dhOrdersWord'), sub: pctLine(moreCur.orders, morePrev?.orders), spark: sparkline(points, win, () => 1, 10), path: '/trading/orders' },
      { key: 'avgorder', label: t('dhAvgOrder'), Icon: Ruler, tone: 'brand', unitTone: 'brand', square: true, value: avgOrder.n, unit: avgOrder.u, sub: pctLine(moreCur.orders ? moreCur.vol / moreCur.orders : 0, morePrev?.orders ? morePrev.vol / morePrev.orders : null) },
      { key: 'margin', label: t('dhAvgMargin'), Icon: Percent, tone: 't5', unitTone: 'brand', value: margin.toFixed(2), unit: '%', valueTone: margin >= 0 ? undefined : 'bad', sub: t('dhNetOfFees') },
      { key: 'fees', label: t('dhFees'), Icon: Receipt, tone: 'warn', unitTone: 'warn', square: true, value: feeParts.n, unit: feeParts.u },
      { key: 'pending', label: t('dhPending'), Icon: Hourglass, tone: pendingApprovals > 0 ? 'bad' : 'good', valueTone: pendingApprovals > 0 ? 'bad' : undefined, value: String(pendingApprovals), sub: pendingApprovals > 0 ? t('dhWaitingOn') : undefined, path: '/trading/orders' },
      { key: 'cover', label: t('dhStockCover'), Icon: Boxes, tone: 'brand2', square: true, unitTone: 'brand', value: stockCoverDays == null ? '—' : String(stockCoverDays), unit: stockCoverDays == null ? '' : t('dhDaysWord'), sub: stockCoverDays == null ? t('dhNoSales') : t('dhAtPace'), path: '/trading/stock' },
    ];
  })();

  const tiles: HomeTile[] = (() => {
    const profit = fiatParts(homeCur.fullNet);
    const unpaid = !loansUnpaid.lead
      ? fiatParts(0)
      : loansUnpaid.lead.currency === 'QAR'
        ? fiatParts(loansUnpaid.lead.remaining)
        : { n: fmtTotal(loansUnpaid.lead.remaining), u: localCur(loansUnpaid.lead.currency, t.lang) };
    const vsP2p = averageStockPrice && p2pAvgs.avgSell ? (p2pAvgs.avgSell - averageStockPrice) / averageStockPrice * 100 : null;
    const avg = averageStockPrice ? priceParts(averageStockPrice) : null;
    return [
      { key: 'profit', label: t('dhProfit'), Icon: BadgeDollarSign, tone: 'good', unitTone: 'brand', value: profit.n, unit: profit.u, sub: `${t('dhFromWord')} ${homeCur.orders} ${t('dhOrdersWord')}`, spark: profitSpark, path: '/trading/orders' },
      {
        key: 'rate', label: t('dhQarEgp'), Icon: ArrowLeftRight, tone: 'brand', square: true, fit: true, spark: tileSparks.rate, value: misrLoading ? '…' : misr ? misr.instaPayV1BanqueMisr.toFixed(4) : '—',
        sub: misr ? `${t('dhBanqueTop')} ${misr.egSellBanqueMisrAvg.toFixed(3)} EGP` : t('noDataAvailable'), path: '/trading/p2p',
      },
      {
        key: 'unpaid', label: t('dhUnpaid'), Icon: Clock, tone: 'bad', unitTone: 'bad', spark: tileSparks.unpaid, valueTone: loansUnpaid.totalRemaining > 0 ? 'bad' : 'good', value: unpaid.n, unit: unpaid.u,
        sub: !loansUnpaid.hasLoans
          ? t('kpiNoLoans')
          : loansUnpaid.totalRemaining === 0
            ? t('loansUnpaidNone')
            : `${loansUnpaid.openCount} ${t('loanCustomerOpenCount')} • ${loansUnpaid.debtorCount} ${loansUnpaid.debtorCount === 1 ? t('kpiCustomerUnit') : t('kpiCustomersUnit')}`,
        path: '/trading/cash',
      },
      { key: 'usdt', label: t('dhUsdtBalance'), Icon: UsdtGlyph, tone: 'good', unitTone: 'brand', spark: tileSparks.usdt, valueTone: isLow ? 'bad' : undefined, value: fmtU(stk, 0), unit: 'USDT', sub: `≈ ${money(stCost)}`, path: '/trading/stock' },
      { key: 'exchange', label: t('dhExchangeBalance'), Icon: Landmark, tone: 'brand', square: true, value: fmtU(binanceUsdt, 0), sub: t('dhSpotFunding'), path: '/trading/stock' },
      {
        key: 'avg', label: t('dhAvgCost'), Icon: PieChart, tone: 'brand', unitTone: 'brand', fit: true, spark: tileSparks.avg, value: avg ? avg.n : t('noStock'), unit: avg?.u,
        sub: vsP2p !== null
          ? <span className={vsP2p >= 0 ? 'good' : 'bad'}>{vsP2p >= 0 ? '↑' : '↓'} {vsP2p >= 0 ? '+' : ''}{fmtPrice(vsP2p)}% {t('dhVsP2p')}</span>
          : t('sellAboveAvPrice'),
        path: '/trading/stock',
      },
    ];
  })();

  // ── My KPIs ──
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>('today');
  const homeKpiOptions = useMemo<KpiOption[]>(() => {
    const L = (en: string, ar: string) => (t.lang === 'ar' ? ar : en);
    const g = L('Tracker', 'التراكر');
    const kWin = rangeWindow(kpiPeriod, nowMinute * 60000, firstTs);
    const { cur, prev } = summarizeWithPrevious(allPoints, kWin);
    const diff = cur.orders - (prev?.orders ?? 0);
    const vs = kpiPeriod === 'today' ? L('vs yesterday', 'مقارنة بالأمس') : L('vs previous period', 'مقارنة بالفترة السابقة');
    const week = { from: nowMinute * 60000 - 7 * 864e5, to: nowMinute * 60000, prevFrom: null, prevTo: null };
    const periodOrders = (customerOrders || []).filter(o => {
      const ts = new Date(o.created_at).getTime();
      return ts >= kWin.from && ts <= kWin.to && o.workflow_status !== 'cancelled';
    });
    const approved = periodOrders.filter(o => o.workflow_status === 'approved').length;
    const clients = activeClients(allPoints, nowMinute * 60000, 30);
    const nowMs = nowMinute * 60000;
    const clientsSpark = Array.from({ length: 6 }, (_, k) => activeClients(allPoints.filter(p => p.ts <= nowMs - (5 - k) * 7 * 864e5), nowMs - (5 - k) * 7 * 864e5, 30).active);
    const convSpark = Array.from({ length: 7 }, (_, k) => {
      const from = nowMs - (7 - k) * 864e5;
      const day = (customerOrders || []).filter(o => { const ts = new Date(o.created_at).getTime(); return ts >= from && ts < from + 864e5 && o.workflow_status !== 'cancelled'; });
      return day.length ? day.filter(o => o.workflow_status === 'approved').length / day.length : 0;
    });
    const stamps = [...allPoints.map(p => p.ts), ...(customerOrders || []).map(o => new Date(o.created_at).getTime())].filter(Number.isFinite);
    const lastSeen = stamps.length ? Math.max(...stamps) : null;
    const fresh: KpiOption[] = [
      { id: 'tracker:newOrders', group: g, label: L('New Orders', 'طلبات جديدة'), value: `+${cur.orders}`, sub: `${diff >= 0 ? '+' : ''}${diff} ${vs}`, strong: cur.orders > 0, icon: 'orders', tone: 'good', spark: sparkline(allPoints, week, () => 1, 7) },
      {
        id: 'tracker:conversion', group: g, label: L('Conversion Rate', 'معدل التحويل'),
        value: periodOrders.length ? `${Math.round((approved / periodOrders.length) * 100)}%` : '—',
        sub: periodOrders.length ? `${approved}/${periodOrders.length} ${L('orders', 'طلب')}` : L('no orders yet', 'لا توجد طلبات'),
        icon: 'conversion', tone: 't5', spark: convSpark,
      },
      { id: 'tracker:activeClients', group: g, label: L('Active Clients', 'العملاء النشطون'), value: String(clients.active), sub: `+${clients.newThisMonth} ${L('this month', 'هذا الشهر')}`, icon: 'clients', tone: 'warn', spark: clientsSpark },
      {
        id: 'tracker:lastOnline', group: g, label: L('Last Online', 'آخر ظهور'),
        value: lastSeen == null ? '—' : agoLabel(Math.round((nowMs - lastSeen) / 1000), t.lang === 'ar' ? 'ar' : 'en'),
        sub: lastSeen == null ? undefined : new Date(lastSeen).toLocaleString(t.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Qatar' }),
        icon: 'online', tone: 'brand',
      },
    ];
    return [...fresh, ...trackerKpiOptions];
  }, [t.lang, kpiPeriod, allPoints, firstTs, nowMinute, customerOrders, trackerKpiOptions]);
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
    <div className="tracker-root dashboard-home-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ minHeight: '100%' }}>
      {topSlot}
      <DashboardHome
        points={points}
        allPoints={allPoints}
        win={win}
        rangeText={rangeText}
        now={nowTs}
        lang={t.lang === 'ar' ? 'ar' : 'en'}
        isAdminView={isAdminView}
        money={money}
        parts={fiatParts}
        tiles={tiles}
        moreTiles={moreTiles}
        fees={fees}
        cash={{ ...fiatParts(cashView.total), total: fiatParts(cashView.total).n, unit: fiatParts(cashView.total).u, counted: cashView.counted, active: cashView.active, accounts: cashView.accounts }}
        onGo={navigate}
      >
        <CustomKpis trackerOptions={homeKpiOptions} lang={t.lang === 'ar' ? 'ar' : 'en'} period={kpiPeriod} onPeriod={setKpiPeriod} />
      </DashboardHome>

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
