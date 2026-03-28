import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtU } from '@/lib/tracker-helpers';
import { TrendingUp, Users, AlertTriangle, Clock } from 'lucide-react';

interface OverviewProps {
  totalCashAvailable: number;
  totalUsdtAvailable: number;
  activeMerchantsCount: number;
  staleCount: number;
  mostRecentUpdate: number | null;
  t: (key: string) => string;
}

export function LiquidityOverviewCards({ totalCashAvailable, totalUsdtAvailable, activeMerchantsCount, staleCount, mostRecentUpdate, t }: OverviewProps) {
  const cards = [
    {
      icon: TrendingUp,
      label: t('liquiditySharedCash') || 'Shared Cash',
      value: fmtU(totalCashAvailable),
      accent: 'text-success',
      bgAccent: 'bg-success/10',
    },
    {
      icon: TrendingUp,
      label: t('liquiditySharedUsdt') || 'Shared USDT',
      value: fmtU(totalUsdtAvailable),
      accent: 'text-primary',
      bgAccent: 'bg-primary/10',
    },
    {
      icon: Users,
      label: t('liquidityActiveMerchants') || 'Active Merchants',
      value: String(activeMerchantsCount),
      accent: 'text-foreground',
      bgAccent: 'bg-muted',
    },
    {
      icon: staleCount > 0 ? AlertTriangle : Clock,
      label: staleCount > 0 ? (t('liquidityStalePostings') || 'Stale Postings') : (t('liquidityFreshness') || 'Last Update'),
      value: staleCount > 0
        ? String(staleCount)
        : mostRecentUpdate
          ? new Date(mostRecentUpdate).toLocaleDateString()
          : '—',
      accent: staleCount > 0 ? 'text-warning' : 'text-muted-foreground',
      bgAccent: staleCount > 0 ? 'bg-warning/10' : 'bg-muted',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/50">
          <CardContent className="p-4 flex items-start gap-3">
            <div className={`p-2 rounded-lg ${card.bgAccent} shrink-0`}>
              <card.icon className={`w-4 h-4 ${card.accent}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground font-medium truncate">{card.label}</p>
              <p className={`text-lg font-bold font-mono tracking-tight ${card.accent}`}>{card.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
