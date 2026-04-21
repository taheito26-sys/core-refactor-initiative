import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, TrendingUp, AlertCircle, Plus, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import {
  formatCustomerNumber, formatCustomerDate,
  listCustomerConnections, listCustomerOrders,
  getDisplayedCustomerRate, getDisplayedCustomerTotal,
  deriveCustomerOrderMeta, type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';

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
function weightedAvgFx(orders: CustomerOrderRow[]): number | null {
  const closed = orders.filter(o => o.status === 'completed');
  const totalQar = closed.reduce((s, o) => s + (o.amount ?? 0), 0);
  const totalEgp = closed.reduce((s, o) => s + (Number(getDisplayedCustomerTotal(o)) || 0), 0);
  if (totalQar <= 0) return null;
  return totalEgp / totalQar;
}

// ── Status map (customer vocabulary) ─────────────────────────────────────────
const STATUS: Record<string, { en: string; ar: string; cls: string }> = {
  pending_quote:    { en: 'Pending',   ar: 'قيد الانتظار', cls: 'bg-amber-500/10 text-amber-600' },
  quoted:           { en: 'Quoted',    ar: 'معروض',        cls: 'bg-blue-500/10 text-blue-600' },
  quote_accepted:   { en: 'Accepted',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  awaiting_payment: { en: 'Sent',      ar: 'مُرسَل',       cls: 'bg-orange-500/10 text-orange-600' },
  payment_sent:     { en: 'Sent',      ar: 'مُرسَل',       cls: 'bg-blue-500/10 text-blue-600' },
  completed:        { en: 'Accepted',  ar: 'مكتمل',        cls: 'bg-emerald-500/10 text-emerald-600' },
  cancelled:        { en: 'Cancelled', ar: 'ملغي',         cls: 'bg-muted text-muted-foreground' },
  quote_rejected:   { en: 'Cancelled', ar: 'ملغي',         cls: 'bg-muted text-muted-foreground' },
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

  const { data: orders = [] } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-dash-orders', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerOrders(userId); return (data ?? []) as CustomerOrderRow[]; },
    enabled: !!userId, refetchInterval: 60_000,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-dash-connections', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });

  const { data: guide } = useQuery({ queryKey: ['c-guide-rate'], queryFn: getQatarEgyptGuideRate, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });

  const metrics = useMemo(() => {
    const now = Date.now();
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();
    const lastMonthStart = startOfMonth(-1).getTime();

    const completed = orders.filter(o => o.status === 'completed');
    const active    = orders.filter(o => !['completed','cancelled','quote_rejected'].includes(o.status));
    const needsAction = orders.filter(o => ['quoted','awaiting_payment'].includes(o.status));

    const thisMonth  = orders.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const lastMonth  = orders.filter(o => { const t = new Date(o.created_at).getTime(); return t >= lastMonthStart && t < monthStart; });
    const thisWeek   = orders.filter(o => new Date(o.created_at).getTime() >= weekStart);

    const totalQar = completed.reduce((s, o) => s + (o.amount ?? 0), 0);
    const totalEgp = completed.reduce((s, o) => s + (Number(getDisplayedCustomerTotal(o)) || 0), 0);
    const avgFx    = weightedAvgFx(orders);
    const weekFx   = weightedAvgFx(thisWeek);

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

  return (
    <div className="space-y-5">
      {/* Hero: live rate */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground">
        <p className="text-sm opacity-80">{L('Welcome back', 'مرحباً')}</p>
        <h1 className="mt-0.5 text-xl font-bold">{customerProfile?.display_name ?? '—'}</h1>
        {guide?.rate != null && (
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-xs opacity-70">QAR → EGP</p>
              <p className="text-3xl font-black tabular-nums">{fmt(guide.rate, 4)}</p>
            </div>
            <button onClick={() => navigate('/c/market')} className="flex items-center gap-1 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30">
              {L('Market', 'السوق')} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Action needed */}
      {metrics.needsAction.length > 0 && (
        <button onClick={() => navigate('/c/orders')} className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left active:scale-[0.99]">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{metrics.needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}</p>
            <p className="text-xs text-muted-foreground">
              {metrics.needsAction.filter(o => o.status === 'quoted').length > 0 && L('Review quotes · ', 'راجع العروض · ')}
              {metrics.needsAction.filter(o => o.status === 'awaiting_payment').length > 0 && L('Send payment', 'أرسل الدفعة')}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
              const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
              const total = getDisplayedCustomerTotal(o);
              const rate  = getDisplayedCustomerRate(o);
              const cfg   = STATUS[o.status] ?? STATUS.pending_quote;
              return (
                <button key={o.id} onClick={() => navigate(`/c/orders?id=${o.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3 text-left active:scale-[0.99]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">{fmt(o.amount)} QAR</span>
                      {total != null && <span className="text-sm font-bold text-emerald-600">→ {fmt(total)} EGP</span>}
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
