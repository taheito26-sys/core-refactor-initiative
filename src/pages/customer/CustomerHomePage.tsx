import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, AlertCircle, Plus, ArrowUpRight, ArrowDownLeft, Calculator, ArrowRight } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import {
  formatCustomerNumber, formatCustomerDate,
  listCustomerConnections,
} from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';
import { listSharedOrdersForActor, type WorkflowOrder } from '@/features/orders/shared-order-workflow';
import { getLocalizedCurrencyName, type CurrencyCode } from '@/lib/currency-locale';

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

// ── Status map (customer vocabulary) ─────────────────────────────────────────
const STATUS: Record<string, { en: string; ar: string; cls: string }> = {
  pending_quote:    { en: 'Pending approval', ar: 'بانتظار الموافقة', cls: 'bg-amber-500/10 text-amber-600' },
  quoted:           { en: 'Awaiting approval', ar: 'بانتظار الموافقة', cls: 'bg-blue-500/10 text-blue-600' },
  quote_accepted:   { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  awaiting_payment: { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  payment_sent:     { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  completed:        { en: 'Approved',  ar: 'مكتمل',        cls: 'bg-emerald-500/10 text-emerald-600' },
  cancelled:        { en: 'Cancelled', ar: 'ملغي',         cls: 'bg-muted text-muted-foreground' },
  quote_rejected:   { en: 'Rejected', ar: 'مرفوض',         cls: 'bg-muted text-muted-foreground' },
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-xl font-black tabular-nums', highlight && 'text-emerald-600')}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const [calcAmount, setCalcAmount] = useState('');

  const { data: orders = [] } = useQuery<WorkflowOrder[]>({
    queryKey: ['c-dash-orders', userId],
    queryFn: async () => { if (!userId) return []; return await listSharedOrdersForActor({ customerUserId: userId }); },
    enabled: !!userId, refetchInterval: 60_000,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-dash-connections', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });

  const { data: marketData } = useQuery({ queryKey: ['c-market-kpis'], queryFn: getCustomerMarketKpis, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });
  const guideRate = marketData?.guide?.rate ?? null;
  const egyptBuyAvg = marketData?.egypt?.buyAvg ?? null;

  const metrics = useMemo(() => {
    const now = Date.now();
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();
    const lastMonthStart = startOfMonth(-1).getTime();

    // For new workflow system: completed = approved, active = pending approval, needsAction = pending customer approval
    const completed = orders.filter(o => o.workflow_status === 'approved');
    const active    = orders.filter(o => o.workflow_status && ['pending_customer_approval', 'pending_merchant_approval'].includes(o.workflow_status));
    const needsAction = orders.filter(o => o.workflow_status === 'pending_customer_approval');

    const thisMonth  = orders.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const lastMonth  = orders.filter(o => { const t = new Date(o.created_at).getTime(); return t >= lastMonthStart && t < monthStart; });
    const thisWeek   = orders.filter(o => new Date(o.created_at).getTime() >= weekStart);

    // Calculate totals using fx_rate from new workflow
    const totalQar = completed.reduce((s, o) => s + (o.amount ?? 0), 0);
    const totalEgp = completed.reduce((s, o) => s + ((o.amount ?? 0) * (o.fx_rate ?? 1)), 0);

    // Average FX rate from completed orders
    const avgFx = completed.length > 0 ? totalEgp / totalQar : null;
    const weekCompleted = thisWeek.filter(o => o.workflow_status === 'approved');
    const weekQar = weekCompleted.reduce((s, o) => s + (o.amount ?? 0), 0);
    const weekEgp = weekCompleted.reduce((s, o) => s + ((o.amount ?? 0) * (o.fx_rate ?? 1)), 0);
    const weekFx = weekCompleted.length > 0 ? weekEgp / weekQar : null;

    // Trend: last 14 days grouped by day
    const trend: { date: string; qar: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      trend.push({ date: d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }), qar: dayOrders.reduce((s, o) => s + (o.amount ?? 0), 0) });
    }
    const maxTrend = Math.max(...trend.map(t => t.qar), 1);

    return {
      thisMonthVol: thisMonth.reduce((s, o) => s + (o.amount ?? 0), 0),
      lastMonthVol: lastMonth.reduce((s, o) => s + (o.amount ?? 0), 0),
      thisWeekVol:  thisWeek.reduce((s, o) => s + (o.amount ?? 0), 0),
      totalQar, totalEgp, avgFx, weekFx,
      active, completed, needsAction, trend, maxTrend,
    };
  }, [orders, lang]);

  const calcResult = guideRate && calcAmount && parseFloat(calcAmount) > 0
    ? parseFloat(calcAmount) * guideRate
    : null;

  return (
    <div className="space-y-5">
      {/* Hero: rates + calculator */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground space-y-4">
        <div>
          <p className="text-sm opacity-80">{L('Welcome back', 'مرحباً')}</p>
          <h1 className="mt-0.5 text-xl font-bold">{customerProfile?.display_name ?? '—'}</h1>
        </div>

        {/* Rate row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] opacity-70 uppercase tracking-wide">QAR/EGP {L('Guide', 'دليل')}</p>
            <p className="text-xl font-black tabular-nums mt-0.5">
              {guideRate != null ? fmt(guideRate, 4) : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] opacity-70 uppercase tracking-wide">{L('Egypt Buy Avg', 'متوسط شراء مصر')}</p>
            <p className="text-xl font-black tabular-nums mt-0.5">
              {egyptBuyAvg != null ? fmt(egyptBuyAvg, 4) : '—'}
            </p>
          </div>
        </div>

        {/* Quick Calculator */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Calculator className="h-3.5 w-3.5 opacity-70" />
            <p className="text-xs opacity-70 font-medium">{L('Quick Calculator', 'حاسبة سريعة')}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                value={calcAmount}
                onChange={e => setCalcAmount(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                className="h-10 w-full rounded-xl bg-white/20 px-3 pe-14 text-sm font-semibold text-white placeholder:text-white/40 outline-none focus:bg-white/25"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-70">QAR</span>
            </div>
            <span className="text-white/60 font-bold">→</span>
            <div className="relative flex-1">
              <input
                value={calcResult != null ? fmt(calcResult, 0) : ''}
                readOnly
                placeholder="0"
                className="h-10 w-full rounded-xl bg-white/10 px-3 pe-14 text-sm font-semibold text-white placeholder:text-white/30 outline-none tabular-nums"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-70">EGP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action needed */}
      {metrics.needsAction.length > 0 && (
        <button onClick={() => navigate('/c/orders')} className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left active:scale-[0.99]">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{metrics.needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}</p>
            <p className="text-xs text-muted-foreground">
              {metrics.needsAction.length > 0 && L('Review quotes', 'راجع العروض')}
            </p>
          </div>
        </button>
      )}

      {/* KPI row: volume periods */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L('Volume (QAR)', 'الحجم (QAR)')}</p>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard label={L('This month', 'هذا الشهر')} value={fmt(metrics.thisMonthVol)} />
          <KpiCard label={L('Last month', 'الشهر الماضي')} value={fmt(metrics.lastMonthVol)} />
          <KpiCard label={L('This week', 'هذا الأسبوع')} value={fmt(metrics.thisWeekVol)} />
        </div>
      </div>

      {/* FX summary */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">QAR → EGP {L('Summary', 'ملخص')}</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/40">
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-[10px] text-muted-foreground">{L('Sent (QAR)', 'مُرسَل')}</p></div>
            <p className="text-lg font-black tabular-nums">{fmt(metrics.totalQar)}</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /><p className="text-[10px] text-muted-foreground">{L('Received (EGP)', 'مُستلَم')}</p></div>
            <p className="text-lg font-black tabular-nums text-emerald-600">{fmt(metrics.totalEgp)}</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><TrendingUp className="h-3.5 w-3.5 text-primary" /><p className="text-[10px] text-muted-foreground">{L('Avg FX', 'متوسط السعر')}</p></div>
            <p className="text-lg font-black tabular-nums">{metrics.avgFx != null ? fmt(metrics.avgFx, 4) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Trend chart (bar) */}
      {orders.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{L('14-day volume', 'حجم 14 يوم')}</p>
          <div className="flex items-end gap-0.5 h-16">
            {metrics.trend.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-sm bg-primary/60 min-h-[2px]"
                  style={{ height: `${Math.max(2, (d.qar / metrics.maxTrend) * 56)}px` }}
                  title={`${d.date}: ${fmt(d.qar)} QAR`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <p className="text-[9px] text-muted-foreground">{metrics.trend[0]?.date}</p>
            <p className="text-[9px] text-muted-foreground">{metrics.trend[metrics.trend.length - 1]?.date}</p>
          </div>
        </div>
      )}

      {/* New order CTA */}
      <button onClick={() => navigate('/c/orders?new=1')} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground active:scale-[0.99]">
        <Plus className="h-4 w-4" />{L('New QAR → EGP Order', 'طلب جديد QAR → EGP')}
      </button>

      {/* Recent activity */}
      {orders.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L('Recent', 'الأخيرة')}</p>
            <button onClick={() => navigate('/c/orders')} className="text-xs text-primary font-medium">{L('All orders', 'كل الطلبات')}</button>
          </div>
          <div className="space-y-2">
            {orders.slice(0, 5).map(o => {
              const total = o.fx_rate ? o.amount * o.fx_rate : null;
              const rate  = o.fx_rate;

              // Map workflow_status to status config for display
              let cfg = STATUS.pending_quote;
              if (o.workflow_status === 'approved') cfg = STATUS.quote_accepted;
              else if (o.workflow_status === 'rejected') cfg = STATUS.quote_rejected;
              else if (o.workflow_status === 'pending_customer_approval' || o.workflow_status === 'pending_merchant_approval') cfg = STATUS.quoted;
              else if (o.workflow_status === 'cancelled') cfg = STATUS.cancelled;

              return (
                <button key={o.id} onClick={() => navigate(`/c/orders?id=${o.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3 text-left active:scale-[0.99]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">{fmt(o.amount)} {getLocalizedCurrencyName((o.send_currency ?? 'QAR') as CurrencyCode, lang === 'ar' ? 'ar' : 'en')}</span>
                      {total != null && <span className="text-sm font-bold text-emerald-600">→ {fmt(total)} {getLocalizedCurrencyName((o.receive_currency ?? 'EGP') as CurrencyCode, lang === 'ar' ? 'ar' : 'en')}</span>}
                      {rate != null && <span className="text-[11px] text-muted-foreground tabular-nums">@ {fmt(rate, 4)}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.cls)}>{lang === 'ar' ? cfg.ar : cfg.en}</span>
                      <span className="text-[11px] text-muted-foreground">{formatCustomerDate(o.created_at, lang)}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/50 py-12 text-center">
          <p className="text-sm text-muted-foreground">{L('No orders yet', 'لا توجد طلبات بعد')}</p>
          <p className="text-xs text-muted-foreground mt-1">{L('Place your first QAR → EGP order above', 'قدّم طلبك الأول أعلاه')}</p>
        </div>
      )}
    </div>
  );
}
