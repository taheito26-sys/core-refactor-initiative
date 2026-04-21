import { useQuery } from '@tanstack/react-query';
import { RefreshCw, TrendingUp, Calculator } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { formatCustomerNumber } from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';

export default function CustomerMarketPage() {
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [calcAmount, setCalcAmount] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['c-market'],
    queryFn: getCustomerMarketKpis,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const fmt = (v: number | null, d = 4) => v != null ? formatCustomerNumber(v, lang, d) : '—';
  const guideRate = data?.guide?.rate ?? null;
  const calcResult = guideRate && calcAmount && parseFloat(calcAmount) > 0
    ? parseFloat(calcAmount) * guideRate
    : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Market', 'السوق')}</h1>
        <button onClick={() => refetch()} disabled={isFetching}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors">
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Guide rate */}
      {guideRate != null && (
        <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4" />
            <p className="text-xs opacity-80 uppercase tracking-wide">{L('Live QAR/EGP Rate', 'سعر QAR/EGP المباشر')}</p>
          </div>
          <p className="text-4xl font-black tabular-nums">{fmt(guideRate)}</p>
          <p className="mt-1 text-xs opacity-70">{L('Updated', 'آخر تحديث')}: {data?.guide?.timestamp ? new Date(data.guide.timestamp).toLocaleTimeString() : '—'}</p>
        </div>
      )}

      {/* Calculator */}
      <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{L('Quick Calculator', 'حاسبة سريعة')}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input value={calcAmount} onChange={e => setCalcAmount(e.target.value)} type="number" min="0" placeholder="0"
              className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 pe-14 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
          </div>
          <div className="flex items-center text-muted-foreground">→</div>
          <div className="relative flex-1">
            <input value={calcResult != null ? fmt(calcResult, 0) : ''} readOnly
              className="h-10 w-full rounded-xl border border-border/50 bg-muted px-3 pe-14 text-sm tabular-nums" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">EGP</span>
          </div>
        </div>
      </div>

      {/* Markets */}
      {isLoading ? (
        <div className="flex justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {[
            { key: 'qatar', label: L('Qatar P2P', 'سوق قطر P2P'), data: data?.qatar },
            { key: 'egypt', label: L('Egypt P2P', 'سوق مصر P2P'), data: data?.egypt },
          ].map(({ key, label, data: m }) => (
            <div key={key} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
                <p className="text-sm font-bold">{label}</p>
                {m?.fetchedAt && <p className="text-[10px] text-muted-foreground">{new Date(m.fetchedAt).toLocaleTimeString()}</p>}
              </div>
              <div className="px-4 divide-y divide-border/40">
                {[
                  [L('Buy Avg', 'متوسط الشراء'), fmt(m?.buyAvg ?? null)],
                  [L('Sell Avg', 'متوسط البيع'), fmt(m?.sellAvg ?? null)],
                  [L('Best Buy', 'أفضل شراء'), fmt(m?.bestBuy ?? null)],
                  [L('Best Sell', 'أفضل بيع'), fmt(m?.bestSell ?? null)],
                  [L('Spread', 'الفارق'), m?.spreadPct != null ? `${fmt(m.spreadPct, 2)}%` : '—'],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between py-2.5 text-sm">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-semibold tabular-nums">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
