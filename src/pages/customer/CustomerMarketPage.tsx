import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { formatCustomerNumber } from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';

function MarketCard({
  label,
  buyAvg,
  sellAvg,
  bestBuy,
  bestSell,
  spreadPct,
  fetchedAt,
  language,
}: {
  label: 'Qatar' | 'Egypt';
  buyAvg: number | null;
  sellAvg: number | null;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPct: number | null;
  fetchedAt: string | null;
  language: 'en' | 'ar';
}) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">Market</div>
            <h2 className="mt-1 text-xl font-black text-foreground">{label}</h2>
          </div>
          <TrendingUp className="h-5 w-5 text-primary" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Metric label="Buy Avg" value={buyAvg != null ? formatCustomerNumber(buyAvg, language, 4) : '-'} />
          <Metric label="Sell Avg" value={sellAvg != null ? formatCustomerNumber(sellAvg, language, 4) : '-'} />
          <Metric label="Best Buy" value={bestBuy != null ? formatCustomerNumber(bestBuy, language, 4) : '-'} />
          <Metric label="Best Sell" value={bestSell != null ? formatCustomerNumber(bestSell, language, 4) : '-'} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/60 px-2 py-1">
            Spread {spreadPct != null ? `${formatCustomerNumber(spreadPct, language, 2)}%` : '-'}
          </span>
          <span className="rounded-full border border-border/60 px-2 py-1">
            Updated {fetchedAt ? new Date(fetchedAt).toLocaleString() : '-'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-black text-foreground">{value}</div>
    </div>
  );
}

export default function CustomerMarketPage() {
  const { settings } = useTheme();
  const t = useT();
  const language = settings.language === 'ar' ? 'ar' : 'en';

  const { data } = useQuery({
    queryKey: ['customer-market-kpis'],
    queryFn: getCustomerMarketKpis,
  });

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{t('customerPortal')}</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">Customer Market</h1>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <MarketCard
          label="Qatar"
          buyAvg={data?.qatar?.buyAvg ?? null}
          sellAvg={data?.qatar?.sellAvg ?? null}
          bestBuy={data?.qatar?.bestBuy ?? null}
          bestSell={data?.qatar?.bestSell ?? null}
          spreadPct={data?.qatar?.spreadPct ?? null}
          fetchedAt={data?.qatar?.fetchedAt ?? null}
          language={language}
        />
        <MarketCard
          label="Egypt"
          buyAvg={data?.egypt?.buyAvg ?? null}
          sellAvg={data?.egypt?.sellAvg ?? null}
          bestBuy={data?.egypt?.bestBuy ?? null}
          bestSell={data?.egypt?.bestSell ?? null}
          spreadPct={data?.egypt?.spreadPct ?? null}
          fetchedAt={data?.egypt?.fetchedAt ?? null}
          language={language}
        />
      </div>

    </div>
  );
}
