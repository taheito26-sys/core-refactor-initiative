import { TrendingUp, TrendingDown, Users, AlertTriangle, FileCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardStats } from '../hooks/useDashboardStats';

import { fmtTotal, fmtPrice } from '@/lib/tracker-helpers';

const formatCurrency = (val: number) =>
  val >= 1000 ? `$${fmtPrice(val / 1000)}K` : `$${fmtTotal(val)}`;

export function StatsGrid() {
  const { data, isLoading } = useDashboardStats();

  const cards = [
    {
      label: 'Total Deployed',
      value: data ? formatCurrency(data.totalDeployed) : '$0',
      icon: TrendingUp,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Active Capital',
      value: data ? formatCurrency(data.activeCapital) : '$0',
      icon: TrendingDown,
      color: 'text-accent',
      bg: 'bg-accent/10',
    },
    {
      label: 'Active Relationships',
      value: data?.activeRelationships?.toString() ?? '0',
      icon: Users,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Pending Approvals',
      value: data?.pendingApprovals?.toString() ?? '0',
      icon: data && data.pendingApprovals > 0 ? AlertTriangle : FileCheck,
      color: data && data.pendingApprovals > 0 ? 'text-warning' : 'text-muted-foreground',
      bg: data && data.pendingApprovals > 0 ? 'bg-warning/10' : 'bg-muted',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/60">
          <CardContent className="p-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {card.label}
                  </span>
                  <span className={`p-1.5 rounded-lg ${card.bg}`}>
                    <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
                  </span>
                </div>
                <span className="text-2xl font-bold font-display text-foreground">
                  {card.value}
                </span>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
