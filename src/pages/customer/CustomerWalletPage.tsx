import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, TrendingUp, ArrowDownLeft, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import {
  deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber,
  getCustomerOrderReceivedAmount, getCustomerOrderSentAmount,
  getDisplayedCustomerRate, listCustomerOrders, type CustomerOrderRow,
} from '@/features/customer/customer-portal';

export default function CustomerWalletPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [filter, setFilter] = useState<'all' | 'completed' | 'active'>('all');

  const { data: orders = [], isLoading } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-wallet', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerOrders(userId);
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const completed = useMemo(() => orders.filter(o => o.status === 'completed'), [orders]);
  const active    = useMemo(() => orders.filter(o => !['completed','cancelled','quote_rejected'].includes(o.status)), [orders]);

  const totalSent     = completed.reduce((s, o) => s + getCustomerOrderSentAmount(o), 0);
  const totalReceived = completed.reduce((s, o) => s + getCustomerOrderReceivedAmount(o), 0);
  const successRate   = orders.length > 0 ? Math.round((completed.length / orders.filter(o => o.status !== 'pending_quote').length) * 100) || 0 : 0;

  const filtered = filter === 'completed' ? completed : filter === 'active' ? active : orders;

  const exportCSV = () => {
    const rows = [
      ['Date','Corridor','Amount QAR','Rate','Total EGP','Rail','Status'],
      ...completed.map(o => {
        const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
        const rate = getDisplayedCustomerRate(o);
        const total = getCustomerOrderReceivedAmount(o);
        return [
          new Date(o.created_at).toLocaleDateString(),
          meta.corridorLabel,
          o.amount,
          rate ?? '',
          total,
          o.payout_rail ?? '',
          o.status,
        ];
      }),
    ].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    a.download = `orders-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Ledger', 'السجل المالي')}</h1>
        {completed.length > 0 && (
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">
            <Download className="h-3.5 w-3.5" />
            {L('Export CSV', 'تصدير CSV')}
          </button>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <ArrowUpRight className="mb-2 h-4 w-4 text-muted-foreground" />
          <p className="text-xl font-black tabular-nums">{formatCustomerNumber(totalSent, lang, 0)}</p>
          <p className="text-[11px] text-muted-foreground">{L('Total sent (QAR)', 'إجمالي المُرسَل (QAR)')}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <ArrowDownLeft className="mb-2 h-4 w-4 text-emerald-500" />
          <p className="text-xl font-black tabular-nums text-emerald-600">{formatCustomerNumber(totalReceived, lang, 0)}</p>
          <p className="text-[11px] text-muted-foreground">{L('Total received (EGP)', 'إجمالي المُستلَم (EGP)')}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-500" />
          <p className="text-xl font-black">{completed.length}</p>
          <p className="text-[11px] text-muted-foreground">{L('Completed orders', 'طلبات مكتملة')}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <TrendingUp className="mb-2 h-4 w-4 text-primary" />
          <p className="text-xl font-black">{successRate}%</p>
          <p className="text-[11px] text-muted-foreground">{L('Success rate', 'معدل النجاح')}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {(['all','completed','active'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors',
              filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
            {f === 'all' ? L('All', 'الكل') : f === 'completed' ? L('Completed', 'مكتمل') : L('Active', 'نشط')}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">{L('No transactions', 'لا توجد معاملات')}</div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          {filtered.map((o, i) => {
            const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
            const rate = getDisplayedCustomerRate(o);
            const received = getCustomerOrderReceivedAmount(o);
            return (
              <div key={o.id} className={cn('px-4 py-3', i > 0 && 'border-t border-border/40')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatCustomerNumber(o.amount, lang, 0)} QAR</span>
                      {o.status === 'completed' && received > 0 && (
                        <span className="text-sm font-semibold text-emerald-600">
                          → {formatCustomerNumber(received, lang, 0)} EGP
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      {rate != null && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatCustomerNumber(rate, lang, 4)} EGP/QAR
                        </span>
                      )}
                      {o.payout_rail && (
                        <span className="text-[11px] text-muted-foreground">{o.payout_rail.replace(/_/g, ' ')}</span>
                      )}
                      <span className="text-[11px] text-muted-foreground">{formatCustomerDate(o.created_at, lang)}</span>
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    o.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                    ['cancelled','quote_rejected'].includes(o.status) ? 'bg-red-500/10 text-red-500' :
                    'bg-amber-500/10 text-amber-600')}>
                    {o.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
