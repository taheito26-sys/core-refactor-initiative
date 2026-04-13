import { useAdminStats } from '../hooks/useAdminStats';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Briefcase, TrendingUp, Shield, Clock, CheckCircle, XCircle, DollarSign } from 'lucide-react';

function StatCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{title}</p>
          <p className="text-xl font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
    );
  }

  if (!stats) return <p className="text-muted-foreground text-sm">Failed to load stats.</p>;

  const cards = [
    { title: 'Total Users', value: stats.total_users, icon: Users, color: 'bg-blue-600' },
    { title: 'Approved', value: stats.approved_users, icon: CheckCircle, color: 'bg-emerald-600' },
    { title: 'Pending', value: stats.pending_users, icon: Clock, color: 'bg-amber-600' },
    { title: 'Rejected', value: stats.rejected_users, icon: XCircle, color: 'bg-red-600' },
    { title: 'Total Deals', value: stats.total_deals, icon: Briefcase, color: 'bg-indigo-600' },
    { title: 'Deals Pending', value: stats.deals_pending, icon: Clock, color: 'bg-orange-600' },
    { title: 'Deals Active', value: stats.deals_active, icon: TrendingUp, color: 'bg-teal-600' },
    { title: 'Deals Completed', value: stats.deals_completed, icon: CheckCircle, color: 'bg-green-600' },
    { title: 'Total Settled', value: `${Number(stats.total_settlement_amount).toLocaleString()} USDT`, icon: DollarSign, color: 'bg-purple-600' },
    { title: 'Total Profit', value: `${Number(stats.total_profit_amount).toLocaleString()} USDT`, icon: TrendingUp, color: 'bg-emerald-700' },
    { title: 'Merchants', value: stats.total_merchant_profiles, icon: Shield, color: 'bg-cyan-600' },
    { title: 'Relationships', value: stats.total_relationships, icon: Users, color: 'bg-violet-600' },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">System Overview</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {cards.map(c => <StatCard key={c.title} {...c} />)}
      </div>
    </div>
  );
}
