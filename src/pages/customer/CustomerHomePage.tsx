import { useLoanPaymentClaims } from '@/hooks/useLoanPaymentClaims';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Plus, X, Wallet, Clock } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  formatCustomerNumber,
  listCustomerConnections, resolveCustomerDisplayName,
} from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';
import { listSharedOrdersForActor, getCashAccountsForUser, type WorkflowOrder } from '@/features/orders/shared-order-workflow';
import { getLocalizedCurrencyName } from '@/lib/currency-locale';
import type { PublicStatement } from '@/features/stock/components/PublicStatementReport';
import { NewOrderForm } from './CustomerOrdersPage';
import { useNotifications } from '@/hooks/useNotifications';
import { CustomerHomeView } from '@/features/customer/home/CustomerHomeView';
import { buildActivity } from '@/features/customer/home/home-model';
import { useRateTrend } from '@/features/customer/home/useRateTrend';

// ── Helpers ───────────────────────────────────────────────────────────────────
function startOfWeek(): Date {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth(offset = 0): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1);
}

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings, update } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const { data: orders = [] } = useQuery<WorkflowOrder[]>({
    queryKey: ['c-dash-orders', userId],
    queryFn: async () => { if (!userId) return []; return await listSharedOrdersForActor({ customerUserId: userId }); },
    enabled: !!userId, refetchInterval: 60_000,
  });

  // Live updates so dashboard reflects merchant-side edits/approvals without a reload.
  const dashQc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`customer-dash-orders-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` },
        () => { dashQc.invalidateQueries({ queryKey: ['c-dash-orders', userId] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, dashQc]);

  // Pre-portal order/loan history — load with a slight delay on mobile to
  // avoid blocking initial render on slow connections. The dashboard shows
  // core metrics without it, and historical data loads asynchronously.
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHistoryReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const { data: historyStatements = [] } = useQuery({
    queryKey: ['c-loan-statement-history', userId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('customer-loan-statement', { method: 'GET' });
      if (error || !data || (data as { error?: string }).error) return [];
      return (data as { statements: PublicStatement[] }).statements;
    },
    enabled: !!userId && historyReady,
    staleTime: 5 * 60_000,
  });

  // `paired` marks rows where the QAR and EGP figures come from the same
  // trade (a loan matched to its binance order by tradeId) — only these can
  // be divided against each other to get a real FX rate. Unmatched rows
  // (an order with no counterpart yet, or a binance leg with no loan) carry
  // a QAR or EGP flow with nothing to pair it to, and mixing them into a
  // rate calculation produces a number that isn't a rate at all.
  const historyRows = useMemo(() => {
    const rows: { ts: number; qar: number; egp: number; paired: boolean }[] = [];
    for (const s of historyStatements) {
      const loanByTradeId = new Map(s.orders.filter(o => o.tradeId).map(o => [o.tradeId as string, o]));
      const seenTradeIds = new Set<string>();
      for (const b of s.binanceOrders ?? []) {
        seenTradeIds.add(b.tradeId);
        const loan = loanByTradeId.get(b.tradeId);
        const qar = loan ? loan.amount : 0;
        const egp = b.fiat === 'EGP' ? b.fiatAmount : 0;
        rows.push({
          ts: typeof b.date === 'string' ? new Date(b.date).getTime() : (b.date ?? 0),
          qar, egp,
          paired: qar > 0 && egp > 0,
        });
      }
      for (const o of s.orders) {
        if (o.tradeId && seenTradeIds.has(o.tradeId)) continue;
        rows.push({ ts: o.date, qar: s.currency === 'QAR' ? o.amount : 0, egp: 0, paired: false });
      }
    }
    return rows;
  }, [historyStatements]);

  // Settlement summary — running debt/payment totals across every
  // statement, not scoped to any month (a balance, not a monthly figure).
  const debtSummary = useMemo(() => {
    let totalDebt = 0, totalPaid = 0, outstanding = 0;
    for (const s of historyStatements) { totalDebt += s.totalLoaned; totalPaid += s.totalRepaid; outstanding += s.outstanding; }
    const currency = historyStatements[0]?.currency ?? 'QAR';
    const settledPct = totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0;
    return { totalDebt, totalPaid, outstanding, currency, settledPct };
  }, [historyStatements]);

  // How old the oldest still-open order is, and how many have crossed the
  // 30-day mark — the same aging signal the merchant sees on their side,
  // computed from the order rows already inside historyStatements.
  const agingStats = useMemo(() => {
    const now = Date.now();
    let oldestDays = 0, overdueCount = 0, openCount = 0;
    for (const s of historyStatements) {
      for (const o of s.orders) {
        if (o.remaining <= 0) continue;
        openCount += 1;
        const days = Math.floor((now - o.date) / 86400000);
        if (days > oldestDays) oldestDays = days;
        if (days > 30) overdueCount += 1;
      }
    }
    return { oldestDays, overdueCount, openCount };
  }, [historyStatements]);

  // Payment history stats — reuses historyStatements' payments array, which
  // is the same data the debt-settlement progress bar above already sums.
  const paymentStats = useMemo(() => {
    let count = 0, total = 0, lastTs: number | null = null;
    for (const s of historyStatements) {
      for (const p of s.payments) {
        count += 1;
        total += p.amount;
        if (lastTs == null || p.date > lastTs) lastTs = p.date;
      }
    }
    return { count, avg: count > 0 ? total / count : 0, lastTs, currency: historyStatements[0]?.currency ?? 'QAR' };
  }, [historyStatements]);

  const { data: connections = [] } = useQuery({
    queryKey: ['c-dash-connections', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });

  const { data: marketData } = useQuery({
    queryKey: ['c-market-kpis'],
    queryFn: getCustomerMarketKpis,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: historyReady,
  });
  const guideRate = marketData?.guide?.rate ?? null;
  const egyptBuyAvg = marketData?.egypt?.buyAvg ?? null;
  const egyptEmergencyAvg = marketData?.egypt?.emergencyAvg ?? null;
  const [showEmergencyInfo, setShowEmergencyInfo] = useState(false);

  // Cash accounts — needed to prompt creation when receiving orders
  const qc = useQueryClient();
  // Same key as CustomerOrdersPage's identical query (same fetch, same
  // params) so navigating Home <-> Orders shares the cache instead of
  // re-fetching the same active cash accounts on every hop.
  const { data: cashAccounts = [] } = useQuery({
    queryKey: ['c-cash-accounts', userId],
    queryFn: async () => { if (!userId) return []; return getCashAccountsForUser(userId); },
    enabled: !!userId,
  });
  const hasCashAccount = cashAccounts.length > 0;

  // Create cash account state
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('bank');
  const [newAccCurrency, setNewAccCurrency] = useState('EGP');
  const [createStep, setCreateStep] = useState(1); // 1=name, 2=type, 3=currency

  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newAccName.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));
      const newId = Math.random().toString(36).slice(2, 10);
      const { data, error } = await supabase.from('cash_accounts').insert({
        id: newId, user_id: userId, name: newAccName.trim(), type: newAccType, currency: newAccCurrency, status: 'active', created_at: Date.now(),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(L('Cash account created!', 'تم إنشاء الحساب!'));
      setShowCreateAccount(false);
      setNewAccName(''); setNewAccType('bank'); setNewAccCurrency('EGP'); setCreateStep(1);
      qc.invalidateQueries({ queryKey: ['c-cash-accounts', userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? L('Failed', 'فشل')),
  });

  const metrics = useMemo(() => {
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();
    const lastMonthStart = startOfMonth(-1).getTime();

    const completed = orders.filter(o => o.workflow_status === 'approved');
    const active    = orders.filter(o => o.workflow_status && ['pending_customer_approval', 'pending_merchant_approval'].includes(o.workflow_status));
    const needsAction = orders.filter(o => o.workflow_status === 'pending_customer_approval');

    // Volume = only orders where customer RECEIVES QAR (merchant placed = customer receives)
    const receivedOrders = orders.filter(o => o.placed_by_role === 'merchant');
    const receivedCompleted = receivedOrders.filter(o => o.workflow_status === 'approved');

    const thisMonth  = receivedOrders.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const lastMonth  = receivedOrders.filter(o => { const t = new Date(o.created_at).getTime(); return t >= lastMonthStart && t < monthStart; });
    const thisWeek   = receivedOrders.filter(o => new Date(o.created_at).getTime() >= weekStart);

    // Pre-portal history — same buckets as the live orders above, since a
    // buyer's real volume/activity usually predates the portal entirely.
    const histThisMonth = historyRows.filter(r => r.ts >= monthStart);
    const histLastMonth = historyRows.filter(r => r.ts >= lastMonthStart && r.ts < monthStart);
    const histThisWeek  = historyRows.filter(r => r.ts >= weekStart);
    const histThisMonthQar = histThisMonth.reduce((s, r) => s + r.qar, 0);
    const histThisMonthEgp = histThisMonth.reduce((s, r) => s + r.egp, 0);

    // Current month completed received orders for summary. Received/Delivered
    // are flow totals and don't need to line up 1:1 (a QAR receipt this
    // month can settle in EGP next month), so they're summed independently.
    const thisMonthCompleted = receivedCompleted.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const monthQar = thisMonthCompleted.reduce((s, o) => s + (o.amount ?? 0), 0) + histThisMonthQar;
    const monthEgp = thisMonthCompleted.reduce((s, o) => s + ((o.amount ?? 0) * (o.fx_rate ?? 1)), 0) + histThisMonthEgp;

    // Avg Rate must come only from trades where both legs are known — dividing
    // the two flow totals above produces a meaningless number whenever
    // received/delivered volumes drift apart for timing reasons.
    const ratedOrders = thisMonthCompleted.filter(o => (o.fx_rate ?? 0) > 0 && (o.amount ?? 0) > 0);
    const pairedQar = ratedOrders.reduce((s, o) => s + (o.amount ?? 0), 0)
      + histThisMonth.filter(r => r.paired).reduce((s, r) => s + r.qar, 0);
    const pairedEgp = ratedOrders.reduce((s, o) => s + (o.amount ?? 0) * (o.fx_rate ?? 0), 0)
      + histThisMonth.filter(r => r.paired).reduce((s, r) => s + r.egp, 0);
    const monthAvgFx = pairedQar > 0 ? pairedEgp / pairedQar : null;

    // EGP-equivalent volume, since the corridor customer cares about what
    // lands in EGP, not the QAR leg. Each order converts at its own
    // fx_rate; only orders/rows with no rate of their own fall back to the
    // best rate estimate available (this month's paired average, else the
    // live market guide rate).
    const fallbackRate = monthAvgFx ?? guideRate ?? egyptBuyAvg ?? null;
    const toEgp = (qar: number, rate: number | null | undefined) => {
      const r = (rate && rate > 0) ? rate : fallbackRate;
      return r ? qar * r : 0;
    };
    const histRangeEgp = (rows: typeof historyRows) =>
      rows.reduce((s, r) => s + (r.paired ? r.egp : toEgp(r.qar, null)), 0);
    const thisMonthVolEgp = thisMonth.reduce((s, o) => s + toEgp(o.amount ?? 0, o.fx_rate), 0) + histRangeEgp(histThisMonth);
    const lastMonthVolEgp = lastMonth.reduce((s, o) => s + toEgp(o.amount ?? 0, o.fx_rate), 0) + histRangeEgp(histLastMonth);
    const thisWeekVolEgp  = thisWeek.reduce((s, o) => s + toEgp(o.amount ?? 0, o.fx_rate), 0) + histRangeEgp(histThisWeek);

    // Order activity stats (replaces 14-day trend)
    const totalOrders = orders.length + historyRows.length;
    const approvedOrders = completed.length + historyRows.length;
    const pendingOrders = active.length;
    const thisMonthOrders = orders.filter(o => new Date(o.created_at).getTime() >= monthStart).length + histThisMonth.length;

    // Trend: last 14 days
    const trend: { date: string; qar: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const dayOrders = receivedOrders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      const dayHistQar = historyRows.filter(r => r.ts >= d.getTime() && r.ts < next.getTime()).reduce((s, r) => s + r.qar, 0);
      trend.push({ date: d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }), qar: dayOrders.reduce((s, o) => s + (o.amount ?? 0), 0) + dayHistQar });
    }
    const maxTrend = Math.max(...trend.map(t => t.qar), 1);

    return {
      thisMonthVol: thisMonth.reduce((s, o) => s + (o.amount ?? 0), 0) + histThisMonth.reduce((s, r) => s + r.qar, 0),
      lastMonthVol: lastMonth.reduce((s, o) => s + (o.amount ?? 0), 0) + histLastMonth.reduce((s, r) => s + r.qar, 0),
      thisWeekVol:  thisWeek.reduce((s, o) => s + (o.amount ?? 0), 0) + histThisWeek.reduce((s, r) => s + r.qar, 0),
      totalVol: receivedOrders.reduce((s, o) => s + (o.amount ?? 0), 0) + historyRows.reduce((s, r) => s + r.qar, 0),
      thisMonthVolEgp, lastMonthVolEgp, thisWeekVolEgp,
      monthQar, monthEgp, monthAvgFx,
      totalOrders, approvedOrders, pendingOrders, thisMonthOrders,
      active, completed, needsAction, trend, maxTrend,
    };
  }, [orders, historyRows, lang, guideRate, egyptBuyAvg]);

  // Alert banners share one compact shape -- collected into a list so the
  // (usually 0-1, rarely all 3) that apply stack tightly with no per-item
  // boilerplate, instead of three near-identical blocks each carrying their
  // own margin.
  const alerts: { key: string; icon: typeof AlertCircle; tone: string; onClick: () => void; title: string; subtitle: string }[] = [];
  if (metrics.needsAction.length > 0) {
    alerts.push({
      key: 'needsAction', icon: AlertCircle, tone: 'amber', onClick: () => navigate('/c/orders'),
      title: `${metrics.needsAction.length} ${L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}`,
      subtitle: L('Review quotes', 'راجع العروض'),
    });
  }
  if (agingStats.overdueCount > 0) {
    alerts.push({
      key: 'overdue', icon: Clock, tone: 'rose', onClick: () => navigate('/c/wallet'),
      title: L(`${agingStats.overdueCount} order(s) overdue`, `${agingStats.overdueCount} طلب متأخر السداد`),
      subtitle: L(`Oldest is ${agingStats.oldestDays} days old`, `الأقدم منذ ${agingStats.oldestDays} يوماً`),
    });
  }
  if (!hasCashAccount && orders.length > 0) {
    alerts.push({
      key: 'noCashAccount', icon: Wallet, tone: 'primary', onClick: () => setShowCreateAccount(true),
      title: L('Set up a cash account to receive funds', 'أنشئ حساباً نقدياً لاستلام الأموال'),
      subtitle: L('Required to approve incoming orders', 'مطلوب للموافقة على الطلبات الواردة'),
    });
  }

  const { unreadCount } = useNotifications();
  const shell = useOutletContext<{ openMenu?: () => void } | null>();
  const rateKey = (name: string) => `ch-rate:${userId ?? 'anon'}:${name}`;
  const avgTrend = useRateTrend(rateKey('avg'), egyptBuyAvg);
  const emergencyTrend = useRateTrend(rateKey('emergency'), egyptEmergencyAvg);
  const { claims: paymentClaims } = useLoanPaymentClaims('customer');
  // A reported payment is in QAR; read it in EGP at the buyer's own average rate across the orders whose QAR and EGP legs are both known,
  // or the live market rate until there are any.
  const claimEgpRate = useMemo(() => {
    const paired = historyRows.filter(r => r.paired);
    const qar = paired.reduce((s, r) => s + r.qar, 0);
    const egp = paired.reduce((s, r) => s + r.egp, 0);
    return qar > 0 && egp > 0 ? egp / qar : (guideRate ?? egyptBuyAvg ?? null);
  }, [historyRows, guideRate, egyptBuyAvg]);
  const activity = useMemo(
    () => buildActivity({
      orders,
      payments: historyStatements.flatMap(s => s.payments.map(p => ({ date: p.date, amount: p.amount, method: p.method ?? null }))),
      loans: historyStatements.flatMap(s => {
        const egpByTrade = new Map((s.binanceOrders ?? []).filter(b => b.fiat === 'EGP').map(b => [b.tradeId, b.fiatAmount]));
        return s.orders.map(o => ({
          ref: o.ref, date: o.date, amount: o.amount, paid: o.paid, settled: o.settled, currency: s.currency,
          egpAmount: o.tradeId ? egpByTrade.get(o.tradeId) ?? null : null,
        }));
      }),
      claims: paymentClaims.map(c => ({ id: c.id, ts: new Date(c.paidAt).getTime(), amount: c.amount, status: c.status, egpRate: c.currency === 'QAR' ? claimEgpRate : null })),
    }),
    [orders, historyStatements, paymentClaims, claimEgpRate],
  );

  const belowHero = (showEmergencyInfo || alerts.length > 0) ? (
    <div className="ch-below">
      {showEmergencyInfo && (
        <p className="rounded-xl bg-primary/10 px-3 py-2 text-[11px] leading-snug text-foreground">
          {L(
            'Banque Misr sell offers on Binance P2P, ranks 2–9 by price (the single best-priced ad is dropped as an outlier).',
            'عروض بيع بنك مصر على Binance P2P، من العرض الثاني حتى التاسع سعراً (يُستبعد أفضل عرض باعتباره استثناءً).',
          )}
        </p>
      )}
      {/* Alert stack — action needed / overdue balance / no cash account */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <button
              key={a.key}
              onClick={a.onClick}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left active:scale-[0.99]',
                a.tone === 'amber' && 'border-amber-500/30 bg-amber-500/10',
                a.tone === 'rose' && 'border-rose-500/30 bg-rose-500/10',
                a.tone === 'primary' && 'border-primary/30 bg-primary/5',
              )}
            >
              <a.icon className={cn('h-4.5 w-4.5 shrink-0',
                a.tone === 'amber' && 'text-amber-500',
                a.tone === 'rose' && 'text-rose-500',
                a.tone === 'primary' && 'text-primary',
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-tight truncate">{a.title}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">{a.subtitle}</p>
              </div>
              {a.tone === 'primary' && <Plus className="h-4 w-4 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}

    </div>
  ) : null;

  return (
    <>
      <CustomerHomeView
        lang={lang}
        name={resolveCustomerDisplayName(customerProfile, lang) ?? '—'}
        unread={unreadCount}
        emergency={{ value: egyptEmergencyAvg, trend: emergencyTrend }}
        average={{ value: egyptBuyAvg, trend: avgTrend }}
        settlement={debtSummary.totalDebt > 0 ? {
          total: debtSummary.totalDebt, paid: debtSummary.totalPaid, remaining: debtSummary.outstanding, pct: debtSummary.settledPct,
          count: paymentStats.count, avg: paymentStats.avg, lastTs: paymentStats.lastTs,
        } : null}
        volume={{ egp: metrics.monthEgp, qar: metrics.monthQar, fx: metrics.monthAvgFx, daily: metrics.trend.map(d => d.qar) }}
        tiles={{ week: metrics.thisWeekVol, month: metrics.thisMonthVol, total: metrics.totalVol }}
        activity={activity}
        fmt={fmt}
        currencyQar={getLocalizedCurrencyName('QAR', lang)}
        currencyEgp={getLocalizedCurrencyName('EGP', lang)}
        onNavigate={navigate}
        onNewOrder={() => setShowNewOrder(true)}
        onSetLang={l => update({ language: l })}
        onOpenMenu={shell?.openMenu}
        onToggleEmergencyInfo={() => setShowEmergencyInfo(v => !v)}
        belowHero={belowHero}
      />

      {/* Create Cash Account Modal — step by step */}
      {showCreateAccount && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateAccount(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-background flex flex-col" style={{ maxHeight: '80dvh' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
              <div>
                <p className="text-sm font-bold">{L('New Cash Account', 'حساب نقدي جديد')}</p>
                <p className="text-[10px] text-muted-foreground">{L(`Step ${createStep} of 3`, `خطوة ${createStep} من 3`)}</p>
              </div>
              <button onClick={() => setShowCreateAccount(false)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>

            {/* Step indicator */}
            <div className="flex gap-1.5 px-4 pt-3 shrink-0">
              {[1,2,3].map(s => (
                <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors', s <= createStep ? 'bg-primary' : 'bg-muted')} />
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
              {/* Step 1: Name */}
              {createStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-base font-bold">{L('What should we call this account?', 'ما اسم هذا الحساب؟')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{L('e.g. My EGP Account, Cairo Bank', 'مثال: حسابي، بنك القاهرة')}</p>
                  </div>
                  <input
                    autoFocus
                    value={newAccName}
                    onChange={e => setNewAccName(e.target.value)}
                    placeholder={L('Account name', 'اسم الحساب')}
                    className="h-12 w-full rounded-xl border border-border/50 bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}

              {/* Step 2: Type */}
              {createStep === 2 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Account type', 'نوع الحساب')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'bank', label: { en: 'Bank Transfer', ar: 'تحويل بنكي' } },
                      { value: 'hand', label: { en: 'Cash', ar: 'نقد' } },
                      { value: 'mobile_wallet', label: { en: 'Mobile Wallet', ar: 'محفظة موبايل' } },
                      { value: 'other', label: { en: 'InstaPay', ar: 'إنستاباي' } },
                    ].map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setNewAccType(t.value)}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors',
                          newAccType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {lang === 'ar' ? t.label.ar : t.label.en}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Currency */}
              {createStep === 3 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Currency', 'العملة')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {['EGP', 'QAR', 'USD'].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewAccCurrency(c)}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-center text-sm font-bold transition-colors',
                          newAccCurrency === c ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {/* Summary */}
                  <div className="rounded-xl bg-muted/30 px-4 py-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Name', 'الاسم')}</span><span className="font-semibold">{newAccName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Type', 'النوع')}</span><span className="font-semibold">{newAccType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Currency', 'العملة')}</span><span className="font-semibold">{newAccCurrency}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 pb-6 pt-3 border-t border-border/40 shrink-0 flex gap-2">
              {createStep > 1 && (
                <button
                  onClick={() => setCreateStep(s => s - 1)}
                  className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted"
                >
                  {L('Back', 'رجوع')}
                </button>
              )}
              <button
                onClick={() => {
                  if (createStep < 3) {
                    if (createStep === 1 && !newAccName.trim()) { toast.error(L('Enter account name', 'أدخل اسم الحساب')); return; }
                    setCreateStep(s => s + 1);
                  } else {
                    createAccountMutation.mutate();
                  }
                }}
                disabled={createAccountMutation.isPending}
                className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {createStep < 3 ? L('Next', 'التالي') : (createAccountMutation.isPending ? L('Creating...', 'جارٍ الإنشاء...') : L('Create Account', 'إنشاء الحساب'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Order Modal — opens inline without navigating away, triggered from Quick Actions above */}
      {showNewOrder && connections.length > 0 && (
        <NewOrderForm
          connections={connections}
          userId={userId!}
          lang={lang}
          onClose={() => setShowNewOrder(false)}
          onCreated={() => { setShowNewOrder(false); }}
        />
      )}

    </>
  );
}
