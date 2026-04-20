import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { formatCustomerNumber } from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', highlight && 'text-primary')}>{value}</span>
    </div>
  );
}

export default function CustomerMarketPage() {
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['c-market-kpis'],
    queryFn: getCustomerMarketKpis,
    staleTime: 5 * 60_000,
  });

  const fmt = (v: number | null) => v != null ? formatCustomerNumber(v, lang, 4) : '—';

  const markets = [
    { key: 'qatar', label: lang === 'ar' ? 'قطر' : 'Qatar',  data: data?.qatar },
    { key: 'egypt', label: lang === 'ar' ? 'مصر'  : 'Egypt',  data: data?.egypt },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{lang === 'ar' ? 'السوق' : 'Market'}</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Guide rate banner */}
      {data?.guide?.rate != null && (
        <div className="rounded-2xl bg-primary/10 border border-primary/20 px-4 py-3">
          <p className="text-[11px] text-primary/70 font-medium uppercase tracking-wide">
            {lang === 'ar' ? 'سعر الدليل QAR/EGP' : 'Guide Rate QAR/EGP'}
          </p>
          <p className="text-2xl font-black text-primary tabular-nums">
            {formatCustomerNumber(data.guide.rate, lang, 4)}
          </p>
        </div>
      )}

      {/* Market cards */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        markets.map(({ key, label, data: m }) => (
          <div key={key} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40">
              <p className="text-sm font-bold text-foreground">{label}</p>
              {m?.fetchedAt && (
                <p className="text-[10px] text-muted-foreground">
                  {new Date(m.fetchedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="px-4">
              <Row label={lang === 'ar' ? 'متوسط الشراء' : 'Buy Avg'}   value={fmt(m?.buyAvg ?? null)} />
              <Row label={lang === 'ar' ? 'متوسط البيع' : 'Sell Avg'}  value={fmt(m?.sellAvg ?? null)} />
              <Row label={lang === 'ar' ? 'أفضل شراء'  : 'Best Buy'}   value={fmt(m?.bestBuy ?? null)} highlight />
              <Row label={lang === 'ar' ? 'أفضل بيع'   : 'Best Sell'}  value={fmt(m?.bestSell ?? null)} highlight />
              <Row
                label={lang === 'ar' ? 'الفارق' : 'Spread'}
                value={m?.spreadPct != null ? `${formatCustomerNumber(m.spreadPct, lang, 2)}%` : '—'}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
