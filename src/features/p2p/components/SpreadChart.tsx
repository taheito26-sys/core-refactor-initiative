import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { type P2PSnapshotRow } from '../hooks/useP2PRateHistory';

interface SpreadChartProps {
  data: P2PSnapshotRow[] | undefined;
  isLoading: boolean;
}

const chartConfig = {
  buyRate: { label: 'Buy', color: 'hsl(var(--destructive))' },
  sellRate: { label: 'Sell', color: 'hsl(var(--success, 142 76% 36%))' },
};

export function SpreadChart({ data, isLoading }: SpreadChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base font-display">Rate Trend</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[200px] w-full" /></CardContent>
      </Card>
    );
  }

  if (!data?.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base font-display">Rate Trend</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No trend data available yet. Rates will appear here once snapshots are fetched.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = [...data]
    .reverse()
    .map((row) => ({
      time: format(new Date(row.fetched_at), 'HH:mm'),
      buyRate: row.buyRate,
      sellRate: row.sellRate,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">Rate Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10 }} />
            <YAxis domain={['auto', 'auto']} className="text-xs" tick={{ fontSize: 10 }} width={50} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="sellRate"
              stroke="var(--color-sellRate)"
              fill="var(--color-sellRate)"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="buyRate"
              stroke="var(--color-buyRate)"
              fill="var(--color-buyRate)"
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
