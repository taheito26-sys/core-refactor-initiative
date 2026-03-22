import { TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { type P2PRateData } from '@/features/dashboard/hooks/useP2PRates';

interface MarketRateCardProps {
  data: P2PRateData | undefined;
  isLoading: boolean;
}

export function MarketRateCard({ data, isLoading }: MarketRateCardProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const hasData = data?.buyRate != null || data?.sellRate != null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Sell Rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Sell Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-2xl font-bold font-display text-foreground">
            {hasData ? data?.sellRate?.toFixed(4) ?? '—' : '—'}
          </span>
          <p className="text-xs text-muted-foreground mt-1">USDT → Local</p>
        </CardContent>
      </Card>

      {/* Buy Rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            Buy Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-2xl font-bold font-display text-foreground">
            {hasData ? data?.buyRate?.toFixed(4) ?? '—' : '—'}
          </span>
          <p className="text-xs text-muted-foreground mt-1">Local → USDT</p>
        </CardContent>
      </Card>

      {/* Spread */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-primary" />
            Spread
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-2xl font-bold font-display text-foreground">
            {data?.spreadPercent != null ? `${data.spreadPercent.toFixed(2)}%` : '—'}
          </span>
          <p className="text-xs text-muted-foreground mt-1">
            {data?.spread != null ? `${data.spread.toFixed(4)} abs` : 'No data'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
